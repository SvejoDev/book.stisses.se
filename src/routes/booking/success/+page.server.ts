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
    console.error('No session ID provided in URL');
    throw error(400, 'Bokningssession saknas.');
  }

  try {
    // Fetch the Stripe session to get the reservation_group_id or booking_number
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // For multiple bookings, check for reservation_group_id
    // For single bookings, check for booking_number (backward compatibility)
    if (!session || (!session.metadata?.reservation_group_id && !session.metadata?.booking_number)) {
      console.error('Invalid or incomplete Stripe session:', session?.id);
      throw error(400, 'Ogiltig bokningssession.');
    }

    // Fetch all bookings associated with this session using stripe_payment_id
    const { data: bookings, error: bookingError } = await supabase
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
          quantity,
          price_at_time,
          price_groups (
            id,
            display_name
          )
        ),
        booking_products (
          quantity,
          price_at_time,
          products (
            id,
            name
          )
        ),
        booking_addons (
          quantity,
          price_at_time,
          addons (
            id,
            name
          )
        )
      `)
      .eq('stripe_payment_id', session.payment_intent)
      .order('created_at', { ascending: true });

    if (bookingError) {
      console.error('Error fetching bookings:', bookingError);
      throw error(500, 'Kunde inte ladda bokningsinformationen.');
    }

    if (!bookings || bookings.length === 0) {
      console.error('No bookings found for session:', sessionId);
      throw error(404, 'Bokningarna kunde inte hittas.');
    }

    return {
      bookings,
      totalBookings: bookings.length
    };

  } catch (e: any) {
    console.error('Error loading success page:', e);
    if (e instanceof error) {
      throw e;
    }
    throw error(500, 'Ett fel uppstod vid hämtning av bokningsbekräftelsen.');
  }
};