import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { SECRET_STRIPE_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';
import { addDays, format, parseISO } from 'date-fns';
import { sv } from 'date-fns/locale';
import { getPaymentPrice } from '$lib/utils/price';
import type { BookingRequest, BookingPayload } from '$lib/types/booking';

const stripe = new Stripe(SECRET_STRIPE_KEY);

export const POST: RequestHandler = async (args: { request: Request }) => {
  try {
    const { bookings }: BookingRequest = await args.request.json();
    
    // Generate a single booking number for all bookings
    // NOTE: For a more robust unique ID, consider using crypto.randomUUID() if traceability is not required
    const bookingNumber = `BK-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    
    // Calculate total price for all bookings (always including VAT)
    const totalPrice = bookings.reduce((sum: number, booking: BookingPayload) => {
      // Use getPaymentPrice to ensure VAT is included for private experiences
      return sum + getPaymentPrice(booking.totalPrice, booking.experienceType);
    }, 0);

    // Create a simplified metadata object to stay within Stripe's 500 character limit
    const metadataBookings = bookings.map((booking: BookingPayload) => ({
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
      success_url: `${args.request.headers.get('origin')}/booking/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${args.request.headers.get('origin')}/booking/cancel`,
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