import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { SECRET_STRIPE_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';
import { addDays, format, parseISO } from 'date-fns';
import { sv } from 'date-fns/locale';
import { getBothPrices, getPaymentPrice } from '$lib/utils/price';

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
    const { bookings } = await request.json();
    
    // Generate a single booking number for all bookings
    const bookingNumber = `BK-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Fetch experience details
    const { data: experience, error: experienceError } = await supabase
      .from('experiences')
      .select('name')
      .eq('id', bookings[0].experienceId)
      .single();

    if (experienceError) throw experienceError;

    // Create metadata object with all booking information
    const bookingMetadata = {
      booking_number: bookingNumber,
      first_name: bookings[0].firstName,
      last_name: bookings[0].lastName,
      email: bookings[0].email,
      phone: bookings[0].phone,
      comment: bookings[0].comment,
      total_price: bookings.reduce((sum: number, booking: any) => sum + booking.totalPrice, 0).toString(),
      bookings: JSON.stringify(bookings.map((booking: any) => ({
        experience_id: booking.experienceId,
        experience_type: booking.experienceType,
        start_location_id: booking.startLocationId,
        duration_id: booking.durationId,
        start_date: booking.startDate,
        end_date: booking.startDate, // Same as start date for now
        start_time: booking.startTime,
        end_time: booking.endTime,
        has_booking_guarantee: booking.hasBookingGuarantee ? 'true' : 'false',
        price_groups: JSON.stringify(booking.priceGroups),
        products: JSON.stringify(booking.products || []),
        addons: JSON.stringify(booking.addons || [])
      })))
    };

    // Calculate the final price for payment (always including VAT regardless of experience type)
    const finalPrice = getPaymentPrice(
      bookings.reduce((sum: number, booking: any) => sum + booking.totalPrice, 0),
      bookings[0].experienceType
    );

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'sek',
            product_data: {
              name: experience.name,
              description: `${bookings.length} bokning${bookings.length > 1 ? 'ar' : ''}`,
              images: [bookings[0].products?.[0]?.image_url]
            },
            unit_amount: Math.round(finalPrice * 100) // Round to whole cents
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: `${request.headers.get('origin')}/booking/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${request.headers.get('origin')}/booking/cancel`,
      customer_email: bookings[0].email,
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