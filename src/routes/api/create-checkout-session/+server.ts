import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { SECRET_STRIPE_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { addDays, format, parseISO } from 'date-fns';
import { sv } from 'date-fns/locale';
import { getPaymentPrice } from '$lib/utils/price';
import type { BookingRequest, BookingPayload } from '$lib/types/api';

const stripe = new Stripe(SECRET_STRIPE_KEY);

// Create a Supabase client with the service role key
const supabase = createClient(
  PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false
    }
  }
);

export const POST: RequestHandler = async (args: { request: Request }) => {
  try {
    const { bookings, reservationGroupId }: BookingRequest & { reservationGroupId?: string } = await args.request.json();
    
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

    let finalReservationGroupId: string;

    if (reservationGroupId) {
      // Use existing reservation group ID from reservation
      finalReservationGroupId = reservationGroupId;
    } else {
      // Generate a new reservation group ID (fallback for non-reservation flow)
      finalReservationGroupId = `RG-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    }

    const bookingMetadata = {
      reservation_group_id: finalReservationGroupId,
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
              name: `Bokning ${finalReservationGroupId}`,
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

    if (reservationGroupId) {
      // Update all pending bookings in this reservation group with session_id AND contact information
      console.log('Updating pending bookings with session_id and contact info:', {
        reservationGroupId,
        sessionId: session.id,
        contactInfo: {
          firstName: bookings[0].firstName,
          lastName: bookings[0].lastName,
          email: bookings[0].email,
          phone: bookings[0].phone
        }
      });
      
      // Debug environment variables
      console.log('Create-checkout environment check:', {
        supabaseUrl: PUBLIC_SUPABASE_URL,
        hasServiceKey: !!SUPABASE_SERVICE_ROLE_KEY,
        serviceKeyPrefix: SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20) + '...'
      });
      
      // First, get all pending bookings in this reservation group
      const { data: pendingBookings, error: fetchError } = await supabase
        .from('pending_bookings')
        .select('*')
        .eq('reservation_group_id', reservationGroupId)
        .eq('availability_reserved', true);

      if (fetchError) {
        console.error('Error fetching pending bookings:', fetchError);
        throw fetchError;
      }

      if (!pendingBookings || pendingBookings.length === 0) {
        throw new Error('No pending bookings found for reservation group');
      }

      // Update each pending booking with session_id and contact information
      const updatePromises = pendingBookings.map(async (booking) => {
        // Find the matching booking data from the request based on booking content
        // Since all bookings share the same contact info, we can use the first booking's contact info
        const requestBookingData = bookings[0];
        
        console.log(`Updating pending booking ${booking.booking_number} with session_id ${session.id}`);
        
        // Update the booking_data with contact information
        const updatedBookingData = booking.booking_data.map((bd: any) => ({
          ...bd,
          firstName: requestBookingData.firstName,
          lastName: requestBookingData.lastName,
          email: requestBookingData.email,
          phone: requestBookingData.phone,
          comment: requestBookingData.comment || bd.comment
        }));

        const result = await supabase
          .from('pending_bookings')
          .update({
            session_id: session.id,
            booking_data: updatedBookingData
          })
          .eq('id', booking.id);
        
        if (result.error) {
          console.error(`Failed to update booking ${booking.booking_number}:`, result.error);
        } else {
          console.log(`Successfully updated booking ${booking.booking_number}`);
          
          // Immediately verify the update by reading it back
          const { data: verifyData, error: verifyError } = await supabase
            .from('pending_bookings')
            .select('booking_number, session_id, expires_at')
            .eq('id', booking.id)
            .single();
          
          if (verifyError) {
            console.error(`Verification failed for booking ${booking.booking_number}:`, verifyError);
          } else if (!verifyData) {
            console.error(`WARNING: Booking ${booking.booking_number} disappeared immediately after update!`);
          } else if (verifyData.session_id !== session.id) {
            console.error(`WARNING: Session ID mismatch for booking ${booking.booking_number}:`, {
              expected: session.id,
              actual: verifyData.session_id
            });
          } else {
            console.log(`✅ Verified booking ${booking.booking_number} update:`, verifyData);
          }
        }
        
        return result;
      });

      const updateResults = await Promise.all(updatePromises);
      const updateErrors = updateResults.filter(result => result.error);

      console.log('Update results summary:', {
        totalBookings: pendingBookings.length,
        successfulUpdates: updateResults.length - updateErrors.length,
        failedUpdates: updateErrors.length,
        errors: updateErrors.map(err => err.error?.message)
      });

      if (updateErrors.length > 0) {
        console.error('Error updating pending bookings:', updateErrors);
        throw new Error(`Failed to update ${updateErrors.length} out of ${pendingBookings.length} bookings: ${updateErrors[0].error?.message}`);
      }
      
      console.log('Successfully updated pending bookings with session_id and contact info:', {
        updatedRows: updateResults.length,
        reservationGroupId,
        sessionId: session.id
      });
      
      // Verify the update by reading it back with retry mechanism
      let verifyData = null;
      let verifyAttempts = 0;
      const maxVerifyAttempts = 3;
      
      while (verifyAttempts < maxVerifyAttempts && (!verifyData || verifyData.length < bookings.length)) {
        if (verifyAttempts > 0) {
          console.log(`Verification retry ${verifyAttempts}: found ${verifyData?.length || 0}/${bookings.length} bookings`);
          await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms
        }
        
        const { data, error: verifyError } = await supabase
          .from('pending_bookings')
          .select('booking_number, session_id, availability_reserved')
          .eq('session_id', session.id);
        
        if (verifyError) {
          console.error('Verification error:', verifyError);
          break;
        }
        
        verifyData = data;
        verifyAttempts++;
      }
      
      console.log('Final verification - bookings with session_id:', {
        sessionId: session.id,
        expected: bookings.length,
        found: verifyData?.length || 0,
        data: verifyData,
        verificationAttempts: verifyAttempts
      });
      
      if (!verifyData || verifyData.length < bookings.length) {
        console.error('WARNING: Verification failed - not all bookings were updated with session_id');
      }
    } else {
      // Store the full booking data in your database (fallback for non-reservation flow)
      // Create separate rows for each booking
      const insertPromises = bookings.map((booking, index) => {
        const bookingNumber = `BK-${Date.now()}-${Math.random().toString(36).slice(2, 11)}-${index}`;
        return supabase
          .from('pending_bookings')
          .insert({
            booking_number: bookingNumber,
            session_id: session.id,
            booking_data: [booking], // Single booking in array for consistency
            availability_reserved: false, // Not reserved since this is fallback flow
            reservation_group_id: finalReservationGroupId
          });
      });

      const results = await Promise.all(insertPromises);
      const errors = results.filter(result => result.error);
      
      if (errors.length > 0) {
        throw errors[0].error;
      }
    }

    return json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return json({ error: 'Could not create checkout session' }, { status: 500 });
  }
};