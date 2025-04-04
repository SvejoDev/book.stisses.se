import { error } from '@sveltejs/kit';
import { supabase } from '$lib/supabaseClient';

export async function load({ params }) {
    const { bookingNumber } = params;

    const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .select(`
            *,
            booking_price_groups (*),
            booking_products (*),
            booking_addons (*)
        `)
        .eq('booking_number', bookingNumber)
        .single();

    if (bookingError) {
        throw error(500, 'Failed to load booking');
    }

    if (!booking) {
        throw error(404, 'Booking not found');
    }

    return {
        booking
    };
}