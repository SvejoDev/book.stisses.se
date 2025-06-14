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

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { reservationGroupId, sessionId, bookingNumber } = await request.json();
    
    let expiredBookings;
    
    if (bookingNumber) {
      // Clean up specific booking by booking number (for user-initiated removal)
      // But NEVER delete bookings that have session_id (they're in payment process)
      const { data, error } = await supabase
        .from('pending_bookings')
        .select('*')
        .eq('booking_number', bookingNumber)
        .is('session_id', null); // Only clean up bookings without session_id
      
      if (error) throw error;
      
      if (!data || data.length === 0) {
        console.log(`Booking ${bookingNumber} not found or has session_id (in payment) - skipping cleanup`);
        return json({
          success: true,
          cleanedUp: 0,
          results: [{
            bookingNumber,
            success: false,
            error: 'Booking not found or in payment process'
          }]
        });
      }
      
      expiredBookings = data;
    } else if (sessionId) {
      // Clean up specific session (for failed payments)
      const { data, error } = await supabase
        .from('pending_bookings')
        .select('*')
        .eq('session_id', sessionId);
      
      if (error) throw error;
      expiredBookings = data;
    } else if (reservationGroupId) {
      // Clean up specific reservation group (for immediate cleanup, e.g., browser close)
      const { data, error } = await supabase
        .from('pending_bookings')
        .select('*')
        .eq('reservation_group_id', reservationGroupId)
        .eq('availability_reserved', true);
      
      if (error) throw error;
      expiredBookings = data;
    } else {
      // Clean up expired reservations AND processed bookings
      const [expiredReservations, processedBookings] = await Promise.all([
        // 1. Clean up expired reservations (but not those with session_id - they're in payment process)
        // Also exclude very recently created bookings (within last 5 minutes) to avoid race conditions
        supabase
        .from('pending_bookings')
        .select('*')
        .eq('availability_reserved', true)
        .lt('expires_at', new Date().toISOString())
        .lt('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString()) // At least 5 minutes old
        .is('session_id', null),
        
        // 2. Clean up processed bookings older than 1 hour
        supabase
          .from('pending_bookings')
          .select('*')
          .eq('availability_reserved', false)
          .lt('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // 1 hour ago
      ]);

      if (expiredReservations.error) throw expiredReservations.error;
      if (processedBookings.error) throw processedBookings.error;

      expiredBookings = [
        ...(expiredReservations.data || []),
        ...(processedBookings.data || [])
      ];
    }

    const cleanupResults = [];

    for (const booking of expiredBookings) {
      try {
        // Process each booking in the booking_data array (now each row has one booking)
        for (const bookingData of booking.booking_data) {
          // Get duration details to calculate proper end date
          const { data: durationData } = await supabase
            .from('durations')
            .select('duration_type, duration_value')
            .eq('id', bookingData.durationId)
            .single();

          // Calculate end date based on duration type
          const isOvernight = durationData?.duration_type === 'overnights';
          const endDate = isOvernight 
            ? calculateEndDate(bookingData.startDate, durationData?.duration_value || 0)
            : bookingData.startDate;

          const formattedProducts = bookingData.products.map((p: any) => ({
            id: p.productId,
            quantity: p.quantity
          }));

          const formattedAddons = bookingData.addons.map((a: any) => ({
            id: a.addonId,
            quantity: a.quantity
          }));

          const bookingForAvailability = {
            start_date: bookingData.startDate,
            end_date: endDate,
            start_time: bookingData.startTime,
            end_time: bookingData.endTime,
            duration_id: bookingData.durationId.toString()
          };

          // Subtract availability (remove the reservation)
          await updateAvailabilityForBooking(
            bookingForAvailability,
            formattedProducts,
            formattedAddons,
            'subtract'
          );
        }

        // Delete the expired booking
        const { error: deleteError } = await supabase
          .from('pending_bookings')
          .delete()
          .eq('id', booking.id);

        if (deleteError) {
          console.error(`Failed to delete booking ${booking.booking_number}:`, deleteError);
          cleanupResults.push({
            bookingNumber: booking.booking_number,
            reservationGroupId: booking.reservation_group_id,
            success: false,
            error: deleteError.message
          });
        } else {
          cleanupResults.push({
            bookingNumber: booking.booking_number,
            reservationGroupId: booking.reservation_group_id,
            success: true
          });
        }

      } catch (error) {
        console.error(`Error cleaning up booking ${booking.booking_number}:`, error);
        cleanupResults.push({
          bookingNumber: booking.booking_number,
          reservationGroupId: booking.reservation_group_id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return json({
      success: true,
      cleanedUp: cleanupResults.length,
      results: cleanupResults
    });

  } catch (error) {
    console.error('Error in cleanup-expired:', error);
    return json({ 
      error: error instanceof Error ? error.message : 'Failed to cleanup expired reservations' 
    }, { status: 500 });
  }
};

// Also support GET for cron jobs
export const GET: RequestHandler = async ({ url }) => {
  try {
    const now = new Date();
    const action = url.searchParams.get('action');
    
    if (action === 'status') {
      // Return status of pending bookings without cleaning up
      const { data: allPendingBookings, error: allError } = await supabase
        .from('pending_bookings')
        .select('booking_number, session_id, expires_at, availability_reserved, created_at')
        .order('created_at', { ascending: false });
      
      if (allError) throw allError;
      
      const { data: expiredBookings, error: expiredError } = await supabase
        .from('pending_bookings')
        .select('booking_number, expires_at')
        .eq('availability_reserved', true)
        .lt('expires_at', now.toISOString());
      
      if (expiredError) throw expiredError;
      
      return json({
        timestamp: now.toISOString(),
        totalPendingBookings: allPendingBookings.length,
        expiredBookings: expiredBookings.length,
        bookings: allPendingBookings.map(booking => ({
          ...booking,
          isExpired: new Date(booking.expires_at) < now,
          hasSessionId: !!booking.session_id
        }))
      });
    }
    
    console.log('Running cleanup at:', now.toISOString());
    console.log('Cleanup safety buffer: excluding bookings created within last 5 minutes (since', new Date(now.getTime() - 5 * 60 * 1000).toISOString(), ')');
    
    // Clean up expired reservations AND processed bookings
    const [expiredReservations, processedBookings] = await Promise.all([
      // 1. Clean up expired reservations (but not those with session_id - they're in payment process)
      // Also exclude very recently created bookings (within last 5 minutes) to avoid race conditions
      supabase
      .from('pending_bookings')
      .select('*')
      .eq('availability_reserved', true)
      .lt('expires_at', now.toISOString())
      .lt('created_at', new Date(now.getTime() - 5 * 60 * 1000).toISOString()) // At least 5 minutes old
      .is('session_id', null),
      
      // 2. Clean up processed bookings older than 1 hour
      supabase
        .from('pending_bookings')
        .select('*')
        .eq('availability_reserved', false)
        .lt('created_at', new Date(now.getTime() - 60 * 60 * 1000).toISOString()) // 1 hour ago
    ]);

    if (expiredReservations.error) throw expiredReservations.error;
    if (processedBookings.error) throw processedBookings.error;

    const expiredBookings = [
      ...(expiredReservations.data || []),
      ...(processedBookings.data || [])
    ];

    console.log(`Found ${expiredBookings.length} expired/processed bookings to clean up (${expiredReservations.data?.length || 0} expired reservations, ${processedBookings.data?.length || 0} processed bookings)`);

    const cleanupResults = [];

    for (const booking of expiredBookings) {
      try {
        console.log(`Cleaning up booking: ${booking.booking_number}, reservation group: ${booking.reservation_group_id}, expired at: ${booking.expires_at}`);
        
        // Process each booking in the booking_data array (now each row has one booking)
        for (const bookingData of booking.booking_data) {
          // Get duration details to calculate proper end date
          const { data: durationData } = await supabase
            .from('durations')
            .select('duration_type, duration_value')
            .eq('id', bookingData.durationId)
            .single();

          // Calculate end date based on duration type
          const isOvernight = durationData?.duration_type === 'overnights';
          const endDate = isOvernight 
            ? calculateEndDate(bookingData.startDate, durationData?.duration_value || 0)
            : bookingData.startDate;

          const formattedProducts = bookingData.products.map((p: any) => ({
            id: p.productId,
            quantity: p.quantity
          }));

          const formattedAddons = bookingData.addons.map((a: any) => ({
            id: a.addonId,
            quantity: a.quantity
          }));

          const bookingForAvailability = {
            start_date: bookingData.startDate,
            end_date: endDate,
            start_time: bookingData.startTime,
            end_time: bookingData.endTime,
            duration_id: bookingData.durationId.toString()
          };

          // Subtract availability (remove the reservation)
          await updateAvailabilityForBooking(
            bookingForAvailability,
            formattedProducts,
            formattedAddons,
            'subtract'
          );
        }

        // Delete the expired booking
        const { error: deleteError } = await supabase
          .from('pending_bookings')
          .delete()
          .eq('id', booking.id);

        if (deleteError) {
          console.error(`Failed to delete booking ${booking.booking_number}:`, deleteError);
          cleanupResults.push({
            bookingNumber: booking.booking_number,
            reservationGroupId: booking.reservation_group_id,
            success: false,
            error: deleteError.message
          });
        } else {
          console.log(`Successfully cleaned up booking: ${booking.booking_number}`);
          cleanupResults.push({
            bookingNumber: booking.booking_number,
            reservationGroupId: booking.reservation_group_id,
            success: true
          });
        }

      } catch (error) {
        console.error(`Error cleaning up booking ${booking.booking_number}:`, error);
        cleanupResults.push({
          bookingNumber: booking.booking_number,
          reservationGroupId: booking.reservation_group_id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return json({
      success: true,
      cleanedUp: cleanupResults.length,
      results: cleanupResults,
      timestamp: now.toISOString()
    });

  } catch (error) {
    console.error('Error in cleanup-expired GET:', error);
    return json({ 
      error: error instanceof Error ? error.message : 'Failed to cleanup expired reservations' 
    }, { status: 500 });
  }
}; 