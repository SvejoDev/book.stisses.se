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
      
      // Debug environment variables
      console.log('Webhook environment check:', {
        supabaseUrl: PUBLIC_SUPABASE_URL,
        hasServiceKey: !!SUPABASE_SERVICE_ROLE_KEY,
        serviceKeyPrefix: SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20) + '...'
      });
      
      // Check ALL pending bookings to see what's in the database
      const { data: allPendingBookings, error: allError } = await supabase
        .from('pending_bookings')
        .select('booking_number, session_id, availability_reserved, expires_at, created_at')
        .order('created_at', { ascending: false })
        .limit(10);
      
      console.log('All recent pending bookings:', {
        count: allPendingBookings?.length || 0,
        bookings: allPendingBookings,
        error: allError?.message
      });
      
      // First, let's check what pending bookings exist with this session_id
      const { data: debugBookings, error: debugError } = await supabase
        .from('pending_bookings')
        .select('booking_number, session_id, availability_reserved, expires_at, created_at')
        .eq('session_id', session.id);
      
      console.log('Debug - All bookings with session_id:', {
        sessionId: session.id,
        bookings: debugBookings,
        error: debugError?.message
      });
      
      // Get expected number of bookings from Stripe metadata
      const expectedBookings = parseInt(session.metadata?.total_bookings || '1');
      console.log(`Expected ${expectedBookings} bookings for session ${session.id}`);
      
      // Retry mechanism for timing issues - now accounts for expected booking count
      let pendingBookings = null;
      let pendingError = null;
      let retryCount = 0;
      const maxRetries = 5; // Increased retries for multi-booking scenarios
      
      while (retryCount < maxRetries && (!pendingBookings || pendingBookings.length < expectedBookings)) {
        if (retryCount > 0) {
          console.log(`Retry ${retryCount} for session ${session.id}: found ${pendingBookings?.length || 0}/${expectedBookings} bookings, waiting 2 seconds...`);
          await delay(2000); // Increased delay for database consistency
        }
        
        // Get all booking data from pending_bookings with this session_id
        const result = await supabase
          .from('pending_bookings')
          .select('*')
          .eq('session_id', session.id);
        
        // Additional debugging: Check all bookings in the reservation group
        if (retryCount === 0) {
          const reservationGroupId = result.data?.[0]?.reservation_group_id;
          
          if (reservationGroupId) {
            const { data: allInGroup, error: groupError } = await supabase
              .from('pending_bookings')
              .select('booking_number, session_id, availability_reserved, reservation_group_id, created_at, expires_at')
              .eq('reservation_group_id', reservationGroupId);
            
            console.log('All bookings in reservation group:', {
              reservationGroupId,
              bookings: allInGroup,
              error: groupError?.message
            });
            
            // Also check if any bookings were recently deleted
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            console.log('Checking for recently deleted bookings since:', fiveMinutesAgo.toISOString());
          }
        }
        
        pendingBookings = result.data;
        pendingError = result.error;
        retryCount++;
      }

      console.log('Pending booking lookup result:', {
        found: !!pendingBookings && pendingBookings.length > 0,
        count: pendingBookings?.length || 0,
        expected: expectedBookings,
        error: pendingError?.message,
        sessionId: session.id,
        bookingNumbers: pendingBookings?.map(b => b.booking_number) || [],
        reservationGroupIds: [...new Set(pendingBookings?.map(b => b.reservation_group_id) || [])],
        retriesUsed: retryCount - 1
      });

      if (pendingError) {
        console.error('Database error fetching pending bookings:', pendingError);
        throw new Error(`Database error: ${pendingError.message}`);
      }

      if (!pendingBookings || pendingBookings.length === 0) {
        console.error('No bookings found for session:', session.id);
        throw new Error('Could not find any pending bookings');
      }

      if (pendingBookings.length < expectedBookings) {
        console.error(`Booking count mismatch: found ${pendingBookings.length}, expected ${expectedBookings}`);
        // Don't throw error immediately - process what we have but log the issue
        console.error('WARNING: Processing partial bookings - this may indicate a race condition');
      }

      // Each pending booking row now contains a single booking in booking_data array
      const allBookingData = pendingBookings.flatMap(pb => pb.booking_data);
      
      console.log(`Processing ${allBookingData.length} bookings from ${pendingBookings.length} pending booking rows for session ${session.id}`);
      
      // Create bookings in parallel with unique numbers
      const bookingPromises = allBookingData.map(async (booking: any, index: number) => {
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
          console.error(`Failed to create booking ${bookingNumber}:`, bookingError);
          throw new Error(`Failed to create booking ${bookingNumber}: ${bookingError.message}`);
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
              throw new Error(`Failed to fetch price groups: ${priceGroupError.message}`);
            }

            const priceMap = new Map(priceGroupData.map(pg => [pg.id, pg.price]));

            const { error: insertError } = await supabase.from('booking_price_groups').insert(
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

            if (insertError) {
              throw new Error(`Failed to insert price groups: ${insertError.message}`);
            }
          })(),

          (async () => {
            const { error: insertError } = await supabase.from('booking_products').insert(
              products.map((p: any) => ({
                booking_id: bookingData.id,
                product_id: p.productId,
                quantity: p.quantity,
                price_at_time: p.price
              }))
            );

            if (insertError) {
              throw new Error(`Failed to insert products: ${insertError.message}`);
            }
          })(),

          (async () => {
            const { error: insertError } = await supabase.from('booking_addons').insert(
              addons.map((a: any) => ({
                booking_id: bookingData.id,
                addon_id: a.addonId,
                quantity: a.quantity,
                price_at_time: a.price
              }))
            );

            if (insertError) {
              throw new Error(`Failed to insert addons: ${insertError.message}`);
            }
          })()
        ]);

        // NOTE: We don't need to update availability here anymore since it was already
        // reserved when the user selected their start time. The availability is already
        // in the tables and just needs to be marked as permanent.
        
        return bookingData;
      });

      // Execute booking creation atomically - either all succeed or all fail
      let createdBookings;
      try {
        console.log(`Starting atomic transaction for ${allBookingData.length} bookings`);
        
        // Wait for ALL bookings to be created successfully before proceeding
        createdBookings = await Promise.all(bookingPromises);
        
        console.log(`All ${createdBookings.length} bookings created successfully`);

        // Delete pending bookings AFTER all bookings are successfully created
        // The availability is now permanently reserved in the bookings table
        const { error: deleteError } = await supabase
          .from('pending_bookings')
          .delete()
          .eq('session_id', session.id);

        if (deleteError) {
          console.error('Error deleting pending bookings, rolling back:', deleteError);
          throw new Error(`Failed to delete pending bookings: ${deleteError.message}`);
        }
        
        console.log(`✅ Deleted ${pendingBookings.length} pending bookings after successful payment`)
        
        console.log(`✅ Transaction completed successfully for ${createdBookings.length} bookings`);
        
      } catch (transactionError) {
        console.error('❌ Transaction failed, rolling back all created bookings:', transactionError);
        
        // Rollback: Delete any bookings that were created
        if (createdBookings && createdBookings.length > 0) {
          const rollbackPromises = createdBookings.map(async (booking) => {
            try {
              // Delete booking and all related data (cascading deletes should handle relations)
              const { error: deleteError } = await supabase
                .from('bookings')
                .delete()
                .eq('id', booking.id);
              
              if (deleteError) {
                console.error(`Failed to rollback booking ${booking.booking_number}:`, deleteError);
              } else {
                console.log(`Rolled back booking: ${booking.booking_number}`);
              }
            } catch (rollbackError) {
              console.error(`Error during rollback of ${booking.booking_number}:`, rollbackError);
            }
          });
          
          await Promise.all(rollbackPromises);
        }
        
        // Re-throw the original error to fail the webhook
        throw transactionError;
      }

      // Send email confirmations
      const failedBookings = await sendEmailsWithRateLimit(createdBookings);

      // Log any failed bookings for follow-up
      if (failedBookings.length > 0) {
        console.error('Failed to send confirmation emails for the following bookings:', failedBookings);
      }

      // Pending bookings are now deleted after successful payment processing
      // The final bookings table serves as the permanent record

    } catch (error) {
      console.error('Error processing webhook:', error);
      return json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  return json({ received: true });
};