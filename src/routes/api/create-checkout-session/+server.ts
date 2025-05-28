import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { SECRET_STRIPE_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';
import { addDays, format, parseISO } from 'date-fns';
import { sv } from 'date-fns/locale';
import { getPaymentPrice } from '$lib/utils/price';
import type { BookingRequest, BookingPayload } from '$lib/types/api';

const stripe = new Stripe(SECRET_STRIPE_KEY);

export const POST: RequestHandler = async (args: { request: Request }) => {
  try {
    const { bookings, bookingNumber }: BookingRequest & { bookingNumber?: string } = await args.request.json();
    
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

    let finalBookingNumber: string;

    if (bookingNumber) {
      // Use existing booking number from reservation
      finalBookingNumber = bookingNumber;
    } else {
      // Generate a new booking number (fallback for non-reservation flow)
      finalBookingNumber = `BK-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    }

    const bookingMetadata = {
      booking_number: finalBookingNumber,
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
              name: `Bokning ${finalBookingNumber}`,
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

    if (bookingNumber) {
      // Update existing pending booking with session_id
      console.log('Updating pending booking with session_id:', {
        bookingNumber,
        sessionId: session.id
      });
      
      const { error: updateError } = await supabase
        .from('pending_bookings')
        .update({
          session_id: session.id,
          booking_data: bookings
        })
        .eq('booking_number', bookingNumber);

      if (updateError) {
        console.error('Error updating pending booking:', updateError);
        throw updateError;
      }
      
      console.log('Successfully updated pending booking with session_id');
    } else {
      // Store the full booking data in your database (fallback for non-reservation flow)
      const { error: storageError } = await supabase
        .from('pending_bookings')
        .insert([
          {
            booking_number: finalBookingNumber,
            session_id: session.id,
            booking_data: bookings,
            availability_reserved: false // Not reserved since this is fallback flow
          }
        ]);

      if (storageError) {
        throw storageError;
      }
    }

    return json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return json({ error: 'Could not create checkout session' }, { status: 500 });
  }
};