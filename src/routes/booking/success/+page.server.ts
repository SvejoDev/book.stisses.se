// src/routes/booking/success/+page.server.ts
import { supabase } from '$lib/supabaseClient';
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ url }) => {
  const bookingId = url.searchParams.get('booking_id');
  
  if (!bookingId) {
    throw error(400, 'No booking ID provided');
  }

  // Fetch booking details with all related data
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select(`
      *,
      experience: experiences!bookings_experience_id_fkey (
        id,
        name,
        type,
        pricing_type
      ),
      start_location: start_locations (
        id,
        name
      ),
      duration: durations (
        id,
        duration_type,
        duration_value,
        extra_price
      ),
      booking_price_groups (
        price_group_id,
        quantity,
        price_at_time,
        price_groups (
          id,
          display_name,
          price
        )
      ),
      booking_products (
        product_id,
        quantity,
        price_at_time,
        products (
          id,
          name
        )
      ),
      booking_addons (
        addon_id,
        quantity,
        price_at_time,
        addons (
          id,
          name
        )
      )
    `)
    .eq('id', bookingId)
    .single();

  if (bookingError) {
    console.error('Failed to load booking details:', bookingError);
    throw error(500, 'Failed to load booking details');
  }

  if (!booking) {
    throw error(404, 'Booking not found');
  }

  return {
    booking
  };
};