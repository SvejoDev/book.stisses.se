// src/routes/booking/success/+page.server.ts
import { supabase } from '$lib/supabaseClient';
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import Stripe from 'stripe';
import { SECRET_STRIPE_KEY } from '$env/static/private';

const stripe = new Stripe(SECRET_STRIPE_KEY);

export const load: PageServerLoad = async ({ url }) => {
  const sessionId = url.searchParams.get('session_id');
  
  if (!sessionId) {
    throw error(400, 'No session ID provided');
  }

  try {
    // Fetch the Stripe session
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (!session || !session.metadata?.booking_number) {
      throw error(400, 'Invalid session');
    }

    // Fetch booking details with all related data using booking number
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
      .eq('booking_number', session.metadata.booking_number)
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
  } catch (e) {
    console.error('Error loading booking:', e);
    throw error(500, 'Failed to load booking details');
  }
};