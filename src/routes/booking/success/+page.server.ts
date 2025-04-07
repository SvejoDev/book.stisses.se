// src/routes/booking/success/+page.server.ts
import { supabase } from '$lib/supabaseClient';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const bookingId = url.searchParams.get('booking_id');
  
  if (!bookingId) {
    throw new Error('No booking ID provided');
  }

  // Fetch booking details with all related data
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select(`
      *,
      booking_price_groups (
        price_group_id,
        quantity,
        price_at_time,
        price_groups (
          display_name
        )
      ),
      booking_products (
        product_id,
        quantity,
        price_at_time,
        products (
          name
        )
      ),
      booking_addons (
        addon_id,
        quantity,
        price_at_time,
        addons (
          name
        )
      )
    `)
    .eq('id', bookingId)
    .single();

  if (bookingError) {
    throw new Error('Failed to load booking details');
  }

  return {
    booking
  };
};