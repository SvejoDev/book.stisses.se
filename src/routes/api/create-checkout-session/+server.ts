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
    
    // Calculate total price for all bookings (always including VAT)
    const totalPrice = bookings.reduce((sum: number, booking: any) => {
      // Use getPaymentPrice to ensure VAT is included for private experiences
      return sum + getPaymentPrice(booking.totalPrice, booking.experienceType);
    }, 0);

    // Create a simplified metadata object to stay within Stripe's 500 character limit
    const metadataBookings = bookings.map((booking: any) => ({
      id: booking.experienceId,
      type: booking.experienceType,
      date: booking.startDate,
      time: `${booking.startTime}-${booking.endTime}`
    }));

    const bookingMetadata = {
      booking_number: bookingNumber,
      first_name: bookings[0].firstName,
      last_name: bookings[0].lastName,
      email: bookings[0].email,
      phone: bookings[0].phone,
      total_bookings: bookings.length.toString(),
      booking_summary: JSON.stringify(metadataBookings)
    };

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'sek',
            product_data: {
              name: `Bokning ${bookingNumber}`,
              description: `${bookings.length} bokning${bookings.length > 1 ? 'ar' : ''}`
            },
            unit_amount: Math.round(totalPrice * 100) // Convert to öre
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

    // Store the full booking data in your database here
    // This way you don't need to rely on Stripe's metadata for all the details
    const { data: storedBookings, error: storageError } = await supabase
      .from('pending_bookings')
      .insert([
        {
          booking_number: bookingNumber,
          session_id: session.id,
          booking_data: bookings
        }
      ]);

    if (storageError) {
      throw storageError;
    }

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