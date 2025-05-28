import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { SECRET_STRIPE_KEY, STRIPE_WEBHOOK_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { getPaymentPrice } from '$lib/utils/price';
import crypto from 'crypto';
import { calculateEndDate } from '$lib/utils/availability-helpers';

// Create a Supabase client with the service role key for the webhook
const supabase = createClient(
  PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false
    }
  }
);

const stripe = new Stripe(SECRET_STRIPE_KEY);

// Helper function to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Send email confirmations for each booking with rate limiting
const sendEmailsWithRateLimit = async (bookings: any[]) => {
  const failedBookings: any[] = [];
  const RATE_LIMIT_DELAY = 1000; // 1 second delay between emails
  const MAX_RETRIES = 3;

  for (const booking of bookings) {
    let retryCount = 0;
    let success = false;

    while (retryCount < MAX_RETRIES && !success) {
      try {
        const emailEndpoint = `${PUBLIC_SUPABASE_URL}/functions/v1/send-booking-confirmation`;
        const response = await fetch(emailEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          },
          body: JSON.stringify({
            bookingId: booking.id
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          if (errorData.name === 'rate_limit_exceeded' && retryCount < MAX_RETRIES - 1) {
            // If rate limited, wait longer before retrying
            await delay(RATE_LIMIT_DELAY * (retryCount + 2));
            retryCount++;
            continue;
          }
          throw new Error(`Failed to send email: ${errorData.message}`);
        }

        success = true;
        // Add delay between successful emails to respect rate limit
        await delay(RATE_LIMIT_DELAY);
      } catch (error) {
        console.error(`Error sending confirmation email for booking ${booking.id} (attempt ${retryCount + 1}):`, error);
        retryCount++;
        
        if (retryCount === MAX_RETRIES) {
          failedBookings.push({
            booking,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        } else {
          // Exponential backoff for retries
          await delay(RATE_LIMIT_DELAY * Math.pow(2, retryCount));
        }
      }
    }
  }

  return failedBookings;
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature!,
      STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    
    try {
      console.log('Webhook processing session:', session.id);
      
      // Get the full booking data from pending_bookings
      const { data: pendingBooking, error: pendingError } = await supabase
        .from('pending_bookings')
        .select('*')
        .eq('session_id', session.id)
        .single();

      console.log('Pending booking lookup result:', {
        found: !!pendingBooking,
        error: pendingError?.message,
        sessionId: session.id
      });

      if (pendingError || !pendingBooking) {
        // Let's also check if there are any bookings with this session_id
        const { data: allBookings } = await supabase
          .from('pending_bookings')
          .select('booking_number, session_id, expires_at, availability_reserved')
          .eq('session_id', session.id);
        
        console.log('No bookings found for session:', session.id);
        console.log('All bookings with this session_id:', allBookings);
        
        throw new Error('Could not find pending booking');
      }

      const bookings = pendingBooking.booking_data;
      
      // Create bookings in parallel with unique numbers
      const bookingPromises = bookings.map(async (booking: any, index: number) => {
        // Generate a unique booking number for each booking
        const timestamp = Date.now();
        const uniqueId = crypto.randomUUID().split('-')[0];
        const bookingNumber = `BK-${timestamp}-${uniqueId}-${index}`;
        
        // Get duration details to calculate proper end date
        const { data: durationData } = await supabase
          .from('durations')
          .select('duration_type, duration_value')
          .eq('id', booking.durationId)
          .single();

        // Calculate end date based on duration type
        const isOvernight = durationData?.duration_type === 'overnights';
        const endDate = isOvernight 
          ? calculateEndDate(booking.startDate, durationData?.duration_value || 0)
          : booking.startDate;
        
        const { data: bookingData, error: bookingError } = await supabase
          .from('bookings')
          .insert([
            {
              booking_number: bookingNumber,
              first_name: booking.firstName,
              last_name: booking.lastName,
              email: booking.email,
              phone: booking.phone,
              comment: booking.comment,
              experience_id: booking.experienceId,
              experience_type: booking.experienceType,
              start_location_id: booking.startLocationId,
              duration_id: booking.durationId,
              start_date: booking.startDate,
              start_time: booking.startTime,
              end_date: endDate,
              end_time: booking.endTime,
              has_booking_guarantee: booking.hasBookingGuarantee,
              total_price: Math.round(getPaymentPrice(booking.totalPrice, booking.experienceType)),
              is_paid: true,
              stripe_payment_id: session.payment_intent as string,
              availability_confirmed: true
            }
          ])
          .select()
          .single();

        if (bookingError) {
          throw bookingError;
        }

        // Process price groups, products, and addons as before
        const priceGroups = booking.priceGroups;
        const products = booking.products;
        const addons = booking.addons;

        const [priceGroupsResult, productsResult, addonsResult] = await Promise.all([
          (async () => {
            const { data: priceGroupData, error: priceGroupError } = await supabase
              .from('price_groups')
              .select('id, price')
              .in('id', Array.isArray(priceGroups) 
                ? priceGroups.map((pg: any) => pg.id)
                : Object.keys(priceGroups).map(id => parseInt(id))
              );

            if (priceGroupError) {
              throw priceGroupError;
            }

            const priceMap = new Map(priceGroupData.map(pg => [pg.id, pg.price]));

            return supabase.from('booking_price_groups').insert(
              Array.isArray(priceGroups) 
                ? priceGroups.map((pg: any) => ({
                    booking_id: bookingData.id,
                    price_group_id: pg.id,
                    quantity: pg.quantity,
                    price_at_time: priceMap.get(pg.id) || 0
                  }))
                : Object.entries(priceGroups).map(([id, quantity]) => ({
                    booking_id: bookingData.id,
                    price_group_id: parseInt(id),
                    quantity,
                    price_at_time: priceMap.get(parseInt(id)) || 0
                  }))
            );
          })(),

          supabase.from('booking_products').insert(
            products.map((p: any) => ({
              booking_id: bookingData.id,
              product_id: p.productId,
              quantity: p.quantity,
              price_at_time: p.price
            }))
          ),

          supabase.from('booking_addons').insert(
            addons.map((a: any) => ({
              booking_id: bookingData.id,
              addon_id: a.addonId,
              quantity: a.quantity,
              price_at_time: a.price
            }))
          )
        ]);

        if (priceGroupsResult.error) {
          throw priceGroupsResult.error;
        }
        if (productsResult.error) {
          throw productsResult.error;
        }
        if (addonsResult.error) {
          throw addonsResult.error;
        }

        // NOTE: We don't need to update availability here anymore since it was already
        // reserved when the user selected their start time. The availability is already
        // in the tables and just needs to be marked as permanent.
        
        return bookingData;
      });

      const createdBookings = await Promise.all(bookingPromises);

      // Mark the pending booking as permanent (availability_reserved = false)
      // This keeps the availability blocked but marks it as a confirmed booking
      const { error: updateError } = await supabase
        .from('pending_bookings')
        .update({ availability_reserved: false })
        .eq('session_id', session.id);

      if (updateError) {
        console.error('Error marking booking as permanent:', updateError);
        // Don't throw here as the booking was created successfully
      }

      // Send email confirmations
      const failedBookings = await sendEmailsWithRateLimit(createdBookings);

      // Log any failed bookings for follow-up
      if (failedBookings.length > 0) {
        console.error('Failed to send confirmation emails for the following bookings:', failedBookings);
      }

      // Note: We don't delete the pending booking anymore since it serves as a record
      // of the reservation and helps with availability tracking

    } catch (error) {
      console.error('Error processing webhook:', error);
      return json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  return json({ received: true });
};