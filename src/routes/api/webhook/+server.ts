import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { SECRET_STRIPE_KEY, STRIPE_WEBHOOK_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { addDays, format, parseISO } from 'date-fns';
import { getPaymentPrice } from '$lib/utils/price';

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
  console.log('Generating date range:', { startDate, endDate });
  const dates: string[] = [];
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  
  let current = start;
  while (current <= end) {
    dates.push(format(current, 'yyyy-MM-dd'));
    current = addDays(current, 1);
  }
  
  console.log('Generated dates:', dates);
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
  console.log(`\n🔍 Checking quantity limit for ${tableName}:`, {
    date,
    startMinutes,
    endMinutes,
    requestedQuantity,
    maxQuantity
  });

  const { data: currentAvailability } = await supabase
    .from(tableName)
    .select('*')
    .eq('datum', date)
    .single();

  console.log('Current availability:', currentAvailability);

  if (!currentAvailability) {
    console.log('No existing availability data, checking against maxQuantity:', maxQuantity);
    return requestedQuantity <= maxQuantity;
  }

  // Check each 15-minute slot
  for (let minute = startMinutes; minute < endMinutes; minute += 15) {
    const slotKey = minute.toString();
    const currentlyBooked = currentAvailability[slotKey] || 0;
    const wouldBeBooked = currentlyBooked + requestedQuantity;

    if (wouldBeBooked > maxQuantity) {
      console.error(`❌ Quantity limit exceeded for ${tableName} at ${date} ${minutesToTime(minute)}`);
      console.error(`Current: ${currentlyBooked}, Requested: ${requestedQuantity}, Max: ${maxQuantity}`);
      return false;
    }
  }

  console.log('✅ Quantity check passed');
  return true;
}

// Helper function to check if date exists and create if it doesn't
async function ensureDateExists(tableName: string, date: string) {
  console.log(`Ensuring date ${date} exists in ${tableName}`);
  
  // First check if date exists
  const { data, error: checkError } = await supabase
    .from(tableName)
    .select('datum')
    .eq('datum', date);

  if (checkError) {
    console.error(`Error checking date in ${tableName}:`, checkError);
    throw checkError;
  }

  // If date doesn't exist, create it
  if (!data || data.length === 0) {
    console.log(`Creating new date entry for ${date} in ${tableName}`);
    const { error: insertError } = await supabase
      .from(tableName)
      .insert({ datum: date });

    if (insertError) {
      console.error(`Error inserting date in ${tableName}:`, insertError);
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
  console.log(`\n📝 Updating availability for ${tableName}:`, {
    date,
    startMinutes,
    endMinutes,
    quantity,
    maxQuantity
  });

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

    console.log('Updating slots:', updates);

    // Update the availability
    const { error: updateError } = await supabase
      .from(tableName)
      .update(updates)
      .eq('datum', date);

    if (updateError) {
      console.error(`Error updating ${tableName}:`, updateError);
      throw updateError;
    }

    console.log('✅ Successfully updated availability');
  } catch (error) {
    console.error(`Failed to update availability for ${tableName}:`, error);
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
  console.log('\n🎯 Starting availability update for booking:', {
    bookingId: bookingData.id,
    startDate: bookingData.start_date,
    endDate: bookingData.end_date,
    startTime: bookingData.start_time,
    endTime: bookingData.end_time,
    products,
    addons
  });

  const startDate = bookingData.start_date;
  const startTime = bookingData.start_time;
  const endTime = bookingData.end_time;
  
  // Get duration details to properly determine if it's overnight
  const { data: durationData } = await supabase
    .from('durations')
    .select('duration_type, duration_value')
    .eq('id', bookingData.duration_id)
    .single();

  console.log('Duration data:', durationData);
  
  // Check if it's an overnight booking based on duration type
  const isOvernight = durationData?.duration_type === 'overnights';
  const endDate = isOvernight 
    ? calculateEndDate(startDate, durationData?.duration_value || 0)
    : bookingData.end_date;

  const dates = generateDateRange(startDate, endDate);
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  console.log('Booking details:', {
    dates,
    startMinutes,
    endMinutes,
    isOvernight,
    durationType: durationData?.duration_type,
    durationValue: durationData?.duration_value,
    calculatedEndDate: endDate
  });

  // Handle products first (all products have availability tracking)
  for (const product of products) {
    console.log(`\n📦 Processing product ${product.id}`);
    
    try {
      // Get product's max quantity
      const { data: productData, error: productError } = await supabase
        .from('products')
        .select('total_quantity')
        .eq('id', product.id)
        .single();

      if (productError) {
        console.error(`Error fetching product ${product.id}:`, productError);
        throw productError;
      }

      if (!productData) {
        console.error(`❌ Product ${product.id} not found`);
        throw new Error(`Product ${product.id} not found`);
      }

      console.log('Product data:', productData);

      const tableName = `availability_product_${product.id}`;

      if (isOvernight) {
        console.log('Processing overnight booking for product', product.id);
        
        // First day: startTime to midnight
        console.log('Processing first day of overnight booking');
        await updateAvailability(
          tableName,
          dates[0],
          startMinutes,
          24 * 60,
          product.quantity,
          productData.total_quantity
        );

        // Middle days (if any): full day coverage
        if (dates.length > 2) {
          console.log('Processing middle days');
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

        // Last day: midnight to endTime
        console.log('Processing last day');
        await updateAvailability(
          tableName,
          dates[dates.length - 1],
          0,
          endMinutes,
          product.quantity,
          productData.total_quantity
        );
      } else {
        // Single day booking
        console.log('Processing single day booking');
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
      console.error(`Error processing product ${product.id}:`, error);
      throw error;
    }
  }

  // Handle addons (need to check track_availability)
  for (const addon of addons) {
    console.log(`\n🔧 Processing addon ${addon.id}`);
    
    try {
      // Check if addon tracks availability and get max quantity
      const { data: addonData } = await supabase
        .from('addons')
        .select('track_availability, total_quantity')
        .eq('id', addon.id)
        .single();

      if (!addonData) {
        console.error(`❌ Addon ${addon.id} not found`);
        throw new Error(`Addon ${addon.id} not found`);
      }

      console.log('Addon data:', addonData);

      if (addonData.track_availability) {
        const tableName = `availability_addon_${addon.id}`;

        if (isOvernight) {
          // First day: startTime to midnight
          console.log('Processing first day of overnight booking');
          await updateAvailability(
            tableName,
            dates[0],
            startMinutes,
            24 * 60,
            addon.quantity,
            addonData.total_quantity
          );

          // Middle days (if any): full day coverage
          if (dates.length > 2) {
            console.log('Processing middle days');
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

          // Last day: midnight to endTime
          console.log('Processing last day');
          await updateAvailability(
            tableName,
            dates[dates.length - 1],
            0,
            endMinutes,
            addon.quantity,
            addonData.total_quantity
          );
        } else {
          // Single day booking
          console.log('Processing single day booking');
          await updateAvailability(
            tableName,
            startDate,
            startMinutes,
            endMinutes,
            addon.quantity,
            addonData.total_quantity
          );
        }
      } else {
        console.log(`Skipping availability update for addon ${addon.id} (not tracked)`);
      }
    } catch (error) {
      console.error(`Error processing addon ${addon.id}:`, error);
      throw error;
    }
  }

  console.log('✅ Completed availability update for booking');
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  let event: Stripe.Event;

  try {
    console.log('\n🎬 Processing webhook event');
    event = stripe.webhooks.constructEvent(
      body,
      signature!,
      STRIPE_WEBHOOK_SECRET
    );
    console.log('Event type:', event.type);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err);
    return json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    console.log('\n💳 Processing completed checkout session:', session.id);
    console.log('Session metadata:', session.metadata);
    
    try {
      // Parse metadata
      const metadata = session.metadata as any;
      const priceGroups = JSON.parse(metadata.price_groups);
      const products = JSON.parse(metadata.products);
      const addons = JSON.parse(metadata.addons);
      
      // Ensure the total price includes VAT
      const experienceType = metadata.experience_type;
      const rawTotalPrice = parseFloat(metadata.total_price);
      const totalPriceIncludingVat = getPaymentPrice(rawTotalPrice, experienceType);
      
      console.log('Price calculations:', {
        rawTotalPrice,
        experienceType,
        totalPriceIncludingVat
      });

      // Create the booking
      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .insert([
          {
            booking_number: metadata.booking_number,
            first_name: metadata.first_name,
            last_name: metadata.last_name,
            email: metadata.email,
            phone: metadata.phone,
            comment: metadata.comment,
            experience_id: metadata.experience_id,
            experience_type: metadata.experience_type,
            start_location_id: metadata.start_location_id,
            duration_id: metadata.duration_id,
            start_date: metadata.start_date,
            start_time: metadata.start_time,
            end_date: metadata.end_date,
            end_time: metadata.end_time,
            has_booking_guarantee: metadata.has_booking_guarantee === 'true',
            total_price: Math.round(totalPriceIncludingVat), // Round to integer for database compatibility
            is_paid: true,
            stripe_payment_id: session.payment_intent as string,
            availability_confirmed: true
          }
        ])
        .select()
        .single();

      if (bookingError) {
        console.error('❌ Error creating booking:', bookingError);
        return json({ error: 'Failed to create booking' }, { status: 500 });
      }

      console.log('Created booking:', booking);

      // Insert related records
      const [priceGroupsResult, productsResult, addonsResult] = await Promise.all([
        // Insert price groups
        (async () => {
          // First fetch the price groups to get their prices
          const { data: priceGroupData, error: priceGroupError } = await supabase
            .from('price_groups')
            .select('id, price')
            .in('id', Array.isArray(priceGroups) 
              ? priceGroups.map(pg => pg.id)
              : Object.keys(priceGroups).map(id => parseInt(id))
            );

          if (priceGroupError) {
            console.error('Error fetching price groups:', priceGroupError);
            throw priceGroupError;
          }

          // Create a map of price group IDs to prices
          const priceMap = new Map(priceGroupData.map(pg => [pg.id, pg.price]));

          // Insert the booking price groups with correct prices
          return supabase.from('booking_price_groups').insert(
            Array.isArray(priceGroups) 
              ? priceGroups.map((pg: any) => ({
                  booking_id: booking.id,
                  price_group_id: pg.id,
                  quantity: pg.quantity,
                  price_at_time: priceMap.get(pg.id) || 0
                }))
              : Object.entries(priceGroups).map(([id, quantity]) => ({
                  booking_id: booking.id,
                  price_group_id: parseInt(id),
                  quantity,
                  price_at_time: priceMap.get(parseInt(id)) || 0
                }))
          );
        })(),

        // Insert products
        supabase.from('booking_products').insert(
          products.map((p: any) => ({
            booking_id: booking.id,
            product_id: p.productId,
            quantity: p.quantity,
            price_at_time: p.price
          }))
        ),

        // Insert addons
        supabase.from('booking_addons').insert(
          addons.map((a: any) => ({
            booking_id: booking.id,
            addon_id: a.addonId,
            quantity: a.quantity,
            price_at_time: a.price
          }))
        )
      ]);

      // Check for errors in related record insertions
      if (priceGroupsResult.error) {
        console.error('Error inserting price groups:', priceGroupsResult.error);
        throw priceGroupsResult.error;
      }
      if (productsResult.error) {
        console.error('Error inserting products:', productsResult.error);
        throw productsResult.error;
      }
      if (addonsResult.error) {
        console.error('Error inserting addons:', addonsResult.error);
        throw addonsResult.error;
      }

      // Format products and addons for availability update
      const formattedProducts = products.map((p: any) => ({
        id: p.productId,
        quantity: p.quantity
      }));

      const formattedAddons = addons.map((a: any) => ({
        id: a.addonId,
        quantity: a.quantity
      }));

      console.log('Updating availability with:', {
        booking,
        products: formattedProducts,
        addons: formattedAddons
      });

      // Update availability for all products and addons
      await updateAvailabilityForBooking(booking as Booking, formattedProducts, formattedAddons);

      // Send booking confirmation email
      try {
        console.log('Attempting to send booking confirmation email for booking:', booking.id);
        const emailEndpoint = `${PUBLIC_SUPABASE_URL}/functions/v1/send-booking-confirmation`;
        console.log('Calling Edge Function at:', emailEndpoint);
        
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

        const responseText = await response.text();
        console.log('Edge Function Response:', {
          status: response.status,
          ok: response.ok,
          body: responseText
        });

        if (!response.ok) {
          console.error('Failed to send booking confirmation email:', responseText);
        } else {
          console.log('Successfully sent booking confirmation email');
        }
      } catch (error) {
        console.error('Error sending booking confirmation email:', error);
      }

      console.log('✅ Successfully processed webhook');
    } catch (error) {
      console.error('❌ Error processing webhook:', error);
      return json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  return json({ received: true });
};