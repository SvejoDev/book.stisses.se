import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { updateAvailabilityForBooking, calculateEndDate } from '$lib/utils/availability-helpers';
import crypto from 'crypto';

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

interface ReservationRequest {
  reservationGroupId?: string; // For extending existing reservations
  bookingData: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    comment?: string;
    experienceId: number;
    experienceType: string;
    startLocationId: number;
    durationId: number;
    startDate: string;
    startTime: string;
    endTime: string;
    hasBookingGuarantee?: boolean;
    totalPrice: number;
    priceGroups: Array<{ id: number; quantity: number }> | Record<string, number>;
    products: Array<{ productId: number; quantity: number; price: number }>;
    addons: Array<{ addonId: number; quantity: number; price: number }>;
  };
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const requestBody = await request.json();
    const { reservationGroupId, bookingData }: ReservationRequest = requestBody;
    
    // Debug logging
    console.log('Reserve availability request:', {
      reservationGroupId,
      bookingDataKeys: bookingData ? Object.keys(bookingData) : 'undefined',
      products: bookingData?.products,
      addons: bookingData?.addons
    });
    
    // Validate and sanitize booking data
    if (!bookingData) {
      return json({ error: 'Missing booking data' }, { status: 400 });
    }

    // Validate required fields
    const missingFields: string[] = [];
    
    if (!bookingData.experienceId) missingFields.push('experienceId');
    if (!bookingData.startLocationId) missingFields.push('startLocationId');
    if (!bookingData.durationId) missingFields.push('durationId');
    if (!bookingData.startDate) missingFields.push('startDate');
    if (!bookingData.startTime) missingFields.push('startTime');
    if (!bookingData.endTime) missingFields.push('endTime');
    
    if (missingFields.length > 0) {
      console.error('Missing required fields:', missingFields, 'in booking data:', bookingData);
      return json({ error: `Missing required fields: ${missingFields.join(', ')}` }, { status: 400 });
    }

    // Ensure products and addons are arrays
    const products = Array.isArray(bookingData.products) ? bookingData.products : [];
    const addons = Array.isArray(bookingData.addons) ? bookingData.addons : [];
    
    console.log('Processed arrays:', { products, addons });
    
    // Calculate expiry time (2 minutes from now for development, plus 2 minutes for each existing booking)
    let baseExpiryMinutes = 2; // Base 2 minutes for development
    
    if (reservationGroupId) {
      // For extending reservations, check how many bookings already exist
      const { data: existingBookings } = await supabase
        .from('pending_bookings')
        .select('id')
        .eq('reservation_group_id', reservationGroupId)
        .eq('availability_reserved', true);
      
      if (existingBookings) {
        // Add 2 minutes for each existing booking
        baseExpiryMinutes += existingBookings.length * 2;
      }
    }
    
    const expiresAt = new Date(Date.now() + baseExpiryMinutes * 60 * 1000);
    
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

    const formattedProducts = products.map(p => ({
      id: p.productId,
      quantity: p.quantity
    }));

    const formattedAddons = addons.map(a => ({
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

    if (reservationGroupId) {
      // Extending existing reservation
      console.log('EXTENDING existing reservation:', reservationGroupId);
      
      const { data: existingBookings, error: fetchError } = await supabase
        .from('pending_bookings')
        .select('*')
        .eq('reservation_group_id', reservationGroupId)
        .eq('availability_reserved', true);

      console.log('Existing booking lookup result:', {
        found: !!existingBookings && existingBookings.length > 0,
        reservationGroupId,
        error: fetchError?.message,
        currentBookingCount: existingBookings?.length || 0
      });

      if (fetchError || !existingBookings || existingBookings.length === 0) {
        console.error('FAILED to find existing reservation for extension:', {
          reservationGroupId,
          error: fetchError?.message
        });
        return json({ error: 'Existing reservation not found or expired' }, { status: 404 });
      }

      // Reserve availability for the new booking
      await updateAvailabilityForBooking(
        bookingForAvailability,
        formattedProducts,
        formattedAddons,
        'add'
      );

      // Generate a unique booking number for this specific booking
      const newBookingNumber = `BK-${Date.now()}-${crypto.randomUUID().split('-')[0]}`;
      
      // Create a new pending booking row for this booking
      const { error: insertError } = await supabase
        .from('pending_bookings')
        .insert({
          booking_number: newBookingNumber,
          session_id: null, // No session yet
          booking_data: [bookingData], // Single booking in array for consistency
          expires_at: expiresAt.toISOString(),
          availability_reserved: true,
          reservation_group_id: reservationGroupId
        });

      if (insertError) {
        // If insert fails, try to rollback availability
        try {
          await updateAvailabilityForBooking(
            bookingForAvailability,
            formattedProducts,
            formattedAddons,
            'subtract'
          );
        } catch (rollbackError) {
          console.error('Failed to rollback availability:', rollbackError);
        }
        throw insertError;
      }

      return json({ 
        success: true, 
        reservationGroupId,
        bookingNumber: newBookingNumber,
        expiresAt: expiresAt.toISOString()
      });

    } else {
      // Creating new reservation
      console.log('CREATING new reservation (no existing reservation group provided)');
      
      const newReservationGroupId = `RG-${Date.now()}-${crypto.randomUUID().split('-')[0]}`;
      const newBookingNumber = `BK-${Date.now()}-${crypto.randomUUID().split('-')[0]}`;

      console.log('Creating new reservation with group ID:', newReservationGroupId);

      // Reserve availability first
      await updateAvailabilityForBooking(
        bookingForAvailability,
        formattedProducts,
        formattedAddons,
        'add'
      );

      // Create pending booking with reservation
      const { error: insertError } = await supabase
        .from('pending_bookings')
        .insert({
          booking_number: newBookingNumber,
          session_id: null, // No session yet - this is now nullable
          booking_data: [bookingData], // Single booking in array for consistency
          expires_at: expiresAt.toISOString(),
          availability_reserved: true,
          reservation_group_id: newReservationGroupId
        });

      if (insertError) {
        console.error('Error inserting pending booking:', insertError);
        // If insert fails, try to rollback availability
        try {
          await updateAvailabilityForBooking(
            bookingForAvailability,
            formattedProducts,
            formattedAddons,
            'subtract'
          );
        } catch (rollbackError) {
          console.error('Failed to rollback availability:', rollbackError);
        }
        throw insertError;
      }

      console.log('Successfully created pending booking:', newBookingNumber);

      return json({ 
        success: true, 
        reservationGroupId: newReservationGroupId,
        bookingNumber: newBookingNumber,
        expiresAt: expiresAt.toISOString()
      });
    }

  } catch (error) {
    console.error('Error reserving availability:', error);
    return json({ 
      error: error instanceof Error ? error.message : 'Failed to reserve availability' 
    }, { status: 500 });
  }
}; 