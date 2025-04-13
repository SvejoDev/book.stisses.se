import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { SECRET_STRIPE_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';
import { addDays, format, parseISO } from 'date-fns';
import { sv } from 'date-fns/locale';
import { getBothPrices } from '$lib/utils/price';

const stripe = new Stripe(SECRET_STRIPE_KEY);

// Helper function to calculate end date for overnight bookings
function calculateEndDate(startDate: string, durationType: string, durationValue: number): string {
  if (durationType !== 'overnights') return startDate;
  const start = parseISO(startDate);
  const end = addDays(start, durationValue);
  return format(end, 'yyyy-MM-dd');
}

// Helper function to check availability
async function checkAvailability(
  productId: number,
  date: string,
  startMinutes: number,
  endMinutes: number,
  requestedQuantity: number
): Promise<boolean> {
  const tableName = `availability_product_${productId}`;
  
  const { data: currentAvailability } = await supabase
    .from(tableName)
    .select('*')
    .eq('datum', date)
    .single();

  if (!currentAvailability) return true; // No existing bookings

  // Check each 15-minute slot
  for (let minute = startMinutes; minute <= endMinutes; minute += 15) {
    const slotKey = minute.toString();
    const currentlyBooked = currentAvailability[slotKey] || 0;
    
    // Get product's max quantity
    const { data: product } = await supabase
      .from('products')
      .select('total_quantity')
      .eq('id', productId)
      .single();
    
    if (!product) return false;
    
    if (currentlyBooked + requestedQuantity > product.total_quantity) {
      return false;
    }
  }

  return true;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      comment,
      experienceId,
      experienceType,
      startLocationId,
      durationId,
      startDate,
      startTime,
      endTime,
      priceGroups,
      products,
      addons,
      totalPrice,
      hasBookingGuarantee
    } = await request.json();

    // Get duration details to calculate proper end date
    const { data: durationData, error: durationError } = await supabase
      .from('durations')
      .select('duration_type, duration_value')
      .eq('id', durationId)
      .single();

    if (durationError) throw durationError;

    // Calculate the proper end date based on duration
    const calculatedEndDate = calculateEndDate(
      startDate,
      durationData.duration_type,
      durationData.duration_value
    );

    // Convert times to minutes
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);

    // Check availability for all products
    for (const product of products) {
      const isAvailable = await checkAvailability(
        product.productId,
        startDate,
        startMinutes,
        endMinutes,
        product.quantity
      );

      if (!isAvailable) {
        return json({ error: 'Selected products are no longer available for the chosen time' }, { status: 400 });
      }

      // If overnight, check next day too
      if (durationData.duration_type === 'overnights') {
        const nextDayAvailable = await checkAvailability(
          product.productId,
          calculatedEndDate,
          0,
          endMinutes,
          product.quantity
        );

        if (!nextDayAvailable) {
          return json({ error: 'Selected products are no longer available for the chosen time' }, { status: 400 });
        }
      }
    }

    // Generate booking number
    const bookingNumber = `BK-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Fetch experience details
    const { data: experience, error: experienceError } = await supabase
      .from('experiences')
      .select('name')
      .eq('id', experienceId)
      .single();

    if (experienceError) throw experienceError;

    // Create metadata object with all booking information
    const bookingMetadata = {
      booking_number: bookingNumber,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      comment,
      experience_id: experienceId,
      experience_type: experienceType,
      start_location_id: startLocationId,
      duration_id: durationId,
      start_date: startDate,
      end_date: calculatedEndDate,
      start_time: startTime,
      end_time: endTime,
      has_booking_guarantee: hasBookingGuarantee ? 'true' : 'false',
      total_price: totalPrice.toString(),
      price_groups: JSON.stringify(priceGroups),
      products: JSON.stringify(products),
      addons: JSON.stringify(addons)
    };

    // Calculate the final price including VAT if applicable
    const finalPrice = getBothPrices(totalPrice, experienceType).priceIncludingVat;

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'sek',
            product_data: {
              name: experience.name,
              description: `${getDurationText(durationData.duration_type, durationData.duration_value)} - ${formatBookingPeriod(startDate, calculatedEndDate, startTime, endTime, durationData.duration_type === 'overnights')}`,
              images: [products[0].image_url]
            },
            unit_amount: finalPrice * 100 // Use the VAT-adjusted price
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: `${request.headers.get('origin')}/booking/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${request.headers.get('origin')}/booking/cancel`,
      customer_email: email,
      metadata: bookingMetadata
    });

    return json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return json({ error: 'Could not create checkout session' }, { status: 500 });
  }
};

// Helper function to convert time to minutes
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// Helper functions
function getDurationText(type: string, value: number): string {
  if (type === 'hours') {
    return value === 1 ? '1 timme' : `${value} timmar`;
  } else if (type === 'overnights') {
    return value === 1 ? '1 övernattning' : `${value} övernattningar`;
  }
  return '';
}

function formatBookingPeriod(startDate: string, endDate: string, startTime: string, endTime: string, isOvernight: boolean): string {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  
  if (isOvernight) {
    return `${format(start, 'EEEE d MMMM', { locale: sv })} ${startTime} - ${format(end, 'EEEE d MMMM', { locale: sv })} ${endTime}`;
  }
  
  return `${format(start, 'EEEE d MMMM', { locale: sv })} ${startTime}-${endTime}`;
}