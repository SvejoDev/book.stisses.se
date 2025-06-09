import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { updateAvailabilityForBooking, calculateEndDate } from '$lib/utils/availability-helpers';

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

interface UpdateReservationTimeRequest {
  reservationGroupId: string;
  bookingNumber: string;
  newStartTime: string;
  newEndTime: string;
  bookingData: {
    experienceId: number;
    startLocationId: number;
    durationId: number;
    startDate: string;
    products: Array<{ productId: number; quantity: number; price: number }>;
    addons: Array<{ addonId: number; quantity: number; price: number }>;
  };
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { 
      reservationGroupId, 
      bookingNumber, 
      newStartTime, 
      newEndTime, 
      bookingData 
    }: UpdateReservationTimeRequest = await request.json();

    console.log('🔄 Update reservation time request:', {
      reservationGroupId,
      bookingNumber,
      newStartTime,
      newEndTime,
      timestamp: Date.now()
    });

    // Validate input
    if (!reservationGroupId || !bookingNumber || !newStartTime || !newEndTime || !bookingData) {
      return json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get the current booking to extract old times
    const { data: currentBooking, error: fetchError } = await supabase
      .from('pending_bookings')
      .select('booking_data, expires_at')
      .eq('reservation_group_id', reservationGroupId)
      .eq('booking_number', bookingNumber)
      .eq('availability_reserved', true)
      .single();

    if (fetchError || !currentBooking) {
      console.error('Failed to find current booking:', fetchError);
      return json({ error: 'Booking not found or expired' }, { status: 404 });
    }

    // Check if booking is still valid (not expired)
    if (new Date(currentBooking.expires_at) <= new Date()) {
      return json({ error: 'Booking has expired' }, { status: 400 });
    }

    const oldBookingData = currentBooking.booking_data[0]; // Single booking per row
    const oldStartTime = oldBookingData.startTime;
    const oldEndTime = oldBookingData.endTime;

    // Skip update if times haven't changed
    if (oldStartTime === newStartTime && oldEndTime === newEndTime) {
      console.log('🔄 No time change detected, skipping update');
      return json({ 
        success: true, 
        message: 'No change needed',
        reservationGroupId,
        bookingNumber,
        expiresAt: currentBooking.expires_at
      });
    }

    console.log('🔄 Performing atomic time update:', {
      old: { startTime: oldStartTime, endTime: oldEndTime },
      new: { startTime: newStartTime, endTime: newEndTime }
    });

    // Get duration details for proper end date calculation
    const { data: durationData } = await supabase
      .from('durations')
      .select('duration_type, duration_value')
      .eq('id', bookingData.durationId)
      .single();

    const isOvernight = durationData?.duration_type === 'overnights';
    const endDate = isOvernight 
      ? calculateEndDate(bookingData.startDate, durationData?.duration_value || 0)
      : bookingData.startDate;

    // Prepare data for availability updates
    const formattedProducts = bookingData.products.map(p => ({
      id: p.productId,
      quantity: p.quantity
    }));

    const formattedAddons = bookingData.addons.map(a => ({
      id: a.addonId,
      quantity: a.quantity
    }));

    const oldBookingForAvailability = {
      start_date: bookingData.startDate,
      end_date: endDate,
      start_time: oldStartTime,
      end_time: oldEndTime,
      duration_id: bookingData.durationId.toString()
    };

    const newBookingForAvailability = {
      start_date: bookingData.startDate,
      end_date: endDate,
      start_time: newStartTime,
      end_time: newEndTime,
      duration_id: bookingData.durationId.toString()
    };

    // Perform atomic update: remove old availability, add new availability, update booking
    try {
      // 1. Remove old availability reservations
      await updateAvailabilityForBooking(
        oldBookingForAvailability,
        formattedProducts,
        formattedAddons,
        'subtract'
      );

      // 2. Add new availability reservations
      await updateAvailabilityForBooking(
        newBookingForAvailability,
        formattedProducts,
        formattedAddons,
        'add'
      );

      // 3. Update the booking record with new times
      const updatedBookingData = [{
        ...oldBookingData,
        startTime: newStartTime,
        endTime: newEndTime
      }];

      const { error: updateError } = await supabase
        .from('pending_bookings')
        .update({ 
          booking_data: updatedBookingData,
          // Extend expiry by 2 minutes since user is actively making changes
          expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString()
        })
        .eq('reservation_group_id', reservationGroupId)
        .eq('booking_number', bookingNumber);

      if (updateError) {
        throw updateError;
      }

      console.log('✅ Atomic time update completed successfully');

      return json({ 
        success: true,
        reservationGroupId,
        bookingNumber,
        expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        oldTime: { startTime: oldStartTime, endTime: oldEndTime },
        newTime: { startTime: newStartTime, endTime: newEndTime }
      });

    } catch (availabilityError) {
      console.error('❌ Error during atomic update, performing rollback:', availabilityError);
      
      // Attempt to rollback: restore old availability if we successfully removed it
      try {
        await updateAvailabilityForBooking(
          oldBookingForAvailability,
          formattedProducts,
          formattedAddons,
          'add'
        );
        console.log('✅ Rollback successful - old availability restored');
      } catch (rollbackError) {
        console.error('❌ Rollback failed:', rollbackError);
      }

      return json({ 
        error: availabilityError instanceof Error ? availabilityError.message : 'Failed to update reservation time'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('❌ Error in update-reservation-time:', error);
    return json({ 
      error: error instanceof Error ? error.message : 'Failed to update reservation time' 
    }, { status: 500 });
  }
}; 