import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { SECRET_STRIPE_KEY, STRIPE_WEBHOOK_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { addDays, format, parseISO } from 'date-fns';
import { getPaymentPrice } from '$lib/utils/price';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

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

// Helper function to convert time (HH:MM) to minutes since midnight
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// Helper function to convert minutes to time string (HH:MM)
function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

// Helper function to generate dates between start and end date
function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  
  let current = start;
  while (current <= end) {
    dates.push(format(current, 'yyyy-MM-dd'));
    current = addDays(current, 1);
  }
  
  return dates;
}

// Helper function to calculate end date for overnight bookings
function calculateEndDate(startDate: string, durationValue: number): string {
  const start = parseISO(startDate);
  const end = addDays(start, durationValue);
  return format(end, 'yyyy-MM-dd');
}

// Helper function to check if quantity exceeds max limit
async function checkQuantityLimit(
  tableName: string,
  date: string,
  startMinutes: number,
  endMinutes: number,
  requestedQuantity: number,
  maxQuantity: number
): Promise<boolean> {
  const { data: currentAvailability } = await supabase
    .from(tableName)
    .select('*')
    .eq('datum', date)
    .single();

  if (!currentAvailability) {
    return requestedQuantity <= maxQuantity;
  }

  // Check each 15-minute slot
  for (let minute = startMinutes; minute < endMinutes; minute += 15) {
    const slotKey = minute.toString();
    const currentlyBooked = currentAvailability[slotKey] || 0;
    const wouldBeBooked = currentlyBooked + requestedQuantity;

    if (wouldBeBooked > maxQuantity) {
      return false;
    }
  }

  return true;
}

// Helper function to check if date exists and create if it doesn't
async function ensureDateExists(tableName: string, date: string) {
  const { data, error: checkError } = await supabase
    .from(tableName)
    .select('datum')
    .eq('datum', date);

  if (checkError) {
    throw checkError;
  }

  // If date doesn't exist, create it
  if (!data || data.length === 0) {
    const { error: insertError } = await supabase
      .from(tableName)
      .insert({ datum: date });

    if (insertError) {
      throw insertError;
    }
  }
}

// Helper function to update availability for a specific table
async function updateAvailability(
  tableName: string,
  date: string,
  startMinutes: number,
  endMinutes: number,
  quantity: number,
  maxQuantity: number
) {
  try {
    // Ensure the date exists first
    await ensureDateExists(tableName, date);

    // Check quantity limits before proceeding
    const isWithinLimits = await checkQuantityLimit(
      tableName,
      date,
      startMinutes,
      endMinutes,
      quantity,
      maxQuantity
    );

    if (!isWithinLimits) {
      throw new Error(`Booking would exceed maximum quantity for ${tableName} on ${date}`);
    }

    // Generate the update object for all 15-minute slots
    const updates: Record<string, number> = {};
    for (let minute = startMinutes; minute <= endMinutes; minute += 15) {
      const slotKey = minute.toString();
      updates[slotKey] = quantity;
    }

    // Update the availability
    const { error: updateError } = await supabase
      .from(tableName)
      .update(updates)
      .eq('datum', date);

    if (updateError) {
      throw updateError;
    }
  } catch (error) {
    throw error;
  }
}

interface BookingProduct {
  product_id: number;
  quantity: number;
}

interface BookingAddon {
  addon_id: number;
  quantity: number;
}

interface Booking {
  id: number;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  duration_id: string;
  booking_products?: BookingProduct[];
  booking_addons?: BookingAddon[];
}

// Main function to handle availability updates
async function updateAvailabilityForBooking(
  bookingData: Booking,
  products: Array<{ id: number; quantity: number }>,
  addons: Array<{ id: number; quantity: number }>
) {
  const startDate = bookingData.start_date;
  const startTime = bookingData.start_time;
  const endTime = bookingData.end_time;
  
  // Get duration details to properly determine if it's overnight
  const { data: durationData } = await supabase
    .from('durations')
    .select('duration_type, duration_value')
    .eq('id', bookingData.duration_id)
    .single();

  // Check if it's an overnight booking based on duration type
  const isOvernight = durationData?.duration_type === 'overnights';
  const endDate = isOvernight 
    ? calculateEndDate(startDate, durationData?.duration_value || 0)
    : bookingData.end_date;

  const dates = generateDateRange(startDate, endDate);
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  // Handle products first (all products have availability tracking)
  for (const product of products) {
    try {
      // Get product's max quantity
      const { data: productData, error: productError } = await supabase
        .from('products')
        .select('total_quantity')
        .eq('id', product.id)
        .single();

      if (productError) {
        throw productError;
      }

      if (!productData) {
        throw new Error(`Product ${product.id} not found`);
      }

      const tableName = `availability_product_${product.id}`;

      if (isOvernight) {
        await updateAvailability(
          tableName,
          dates[0],
          startMinutes,
          24 * 60,
          product.quantity,
          productData.total_quantity
        );

        if (dates.length > 2) {
          for (let i = 1; i < dates.length - 1; i++) {
            await updateAvailability(
              tableName,
              dates[i],
              0,
              24 * 60,
              product.quantity,
              productData.total_quantity
            );
          }
        }

        await updateAvailability(
          tableName,
          dates[dates.length - 1],
          0,
          endMinutes,
          product.quantity,
          productData.total_quantity
        );
      } else {
        await updateAvailability(
          tableName,
          startDate,
          startMinutes,
          endMinutes,
          product.quantity,
          productData.total_quantity
        );
      }
    } catch (error) {
      throw error;
    }
  }

  // Handle addons (need to check track_availability)
  for (const addon of addons) {
    try {
      // Check if addon tracks availability and get max quantity
      const { data: addonData } = await supabase
        .from('addons')
        .select('track_availability, total_quantity')
        .eq('id', addon.id)
        .single();

      if (!addonData) {
        throw new Error(`Addon ${addon.id} not found`);
      }

      if (addonData.track_availability) {
        const tableName = `availability_addon_${addon.id}`;

        if (isOvernight) {
          await updateAvailability(
            tableName,
            dates[0],
            startMinutes,
            24 * 60,
            addon.quantity,
            addonData.total_quantity
          );

          if (dates.length > 2) {
            for (let i = 1; i < dates.length - 1; i++) {
              await updateAvailability(
                tableName,
                dates[i],
                0,
                24 * 60,
                addon.quantity,
                addonData.total_quantity
              );
            }
          }

          await updateAvailability(
            tableName,
            dates[dates.length - 1],
            0,
            endMinutes,
            addon.quantity,
            addonData.total_quantity
          );
        } else {
          await updateAvailability(
            tableName,
            startDate,
            startMinutes,
            endMinutes,
            addon.quantity,
            addonData.total_quantity
          );
        }
      }
    } catch (error) {
      throw error;
    }
  }
}

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
      // Get the full booking data from pending_bookings
      const { data: pendingBooking, error: pendingError } = await supabase
        .from('pending_bookings')
        .select('*')
        .eq('session_id', session.id)
        .single();

      if (pendingError || !pendingBooking) {
        throw new Error('Could not find pending booking');
      }

      const bookings = pendingBooking.booking_data;
      
      // Create bookings in parallel with unique numbers
      const bookingPromises = bookings.map(async (booking: any, index: number) => {
        // Generate a unique booking number for each booking
        const timestamp = Date.now();
        const uniqueId = crypto.randomUUID().split('-')[0];
        const bookingNumber = `BK-${timestamp}-${uniqueId}-${index}`;
        
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
              end_date: booking.startDate,
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

        const formattedProducts = products.map((p: any) => ({
          id: p.productId,
          quantity: p.quantity
        }));

        const formattedAddons = addons.map((a: any) => ({
          id: a.addonId,
          quantity: a.quantity
        }));

        await updateAvailabilityForBooking(bookingData, formattedProducts, formattedAddons);
        
        return bookingData;
      });

      const createdBookings = await Promise.all(bookingPromises);

      // Replace the email sending code with:
      const failedBookings = await sendEmailsWithRateLimit(createdBookings);

      // Log any failed bookings for follow-up
      if (failedBookings.length > 0) {
        console.error('Failed to send confirmation emails for the following bookings:', failedBookings);
       
      }

      // Clean up the pending booking
      await supabase
        .from('pending_bookings')
        .delete()
        .eq('session_id', session.id);

    } catch (error) {
      console.error('Error processing webhook:', error);
      return json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  return json({ received: true });
};