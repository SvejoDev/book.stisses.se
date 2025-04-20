import { supabase } from "$lib/supabaseClient";
import { error } from '@sveltejs/kit';

export async function load({ params }) {
    const { bookingId } = params;
    
    if (!bookingId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
        throw error(400, "Invalid booking ID");
    }

    const today = new Date().toISOString().split('T')[0];

    // First fetch the booking to get the experience ID
    const { data: booking, error: bookingError } = await supabase
        .from("bookings")
        .select(`
            *,
            experience:experiences!bookings_experience_id_fkey (
                name,
                booking_foresight_hours
            ),
            start_location:start_locations (
                name
            ),
            duration:durations (
                duration_type,
                duration_value,
                extra_price
            ),
            booking_price_groups (
                quantity,
                price_at_time,
                price_groups (
                    display_name,
                    id
                )
            ),
            booking_products (
                quantity,
                price_at_time,
                products (
                    id,
                    name,
                    total_quantity
                )
            ),
            booking_addons (
                quantity,
                price_at_time,
                addons (
                    id,
                    name,
                    total_quantity,
                    track_availability
                )
            )
        `)
        .eq("id", bookingId)
        .single();

    if (bookingError || !booking) {
        throw error(404, "Booking not found");
    }

    // Fetch open dates for this experience
    const { data: openDates, error: openDatesError } = await supabase
        .from("experience_open_dates")
        .select("*")
        .eq("experience_id", booking.experience_id);

    if (openDatesError) {
        console.error('Open dates error:', openDatesError);
        throw error(500, "Failed to load open dates");
    }

    // Filter open dates to only include future dates
    const filteredOpenDates = (openDates || []).filter(date => {
        if (date.type === 'interval') {
            return date.end_date >= today;
        } else {
            return date.specific_date >= today;
        }
    });

    // Fetch blocked dates for this experience
    const { data: blockedDates, error: blockedDatesError } = await supabase
        .from("experience_blocked_dates")
        .select("*")
        .eq("experience_id", booking.experience_id)
        .gte('end_date', today);

    if (blockedDatesError) {
        console.error('Blocked dates error:', blockedDatesError);
        throw error(500, "Failed to load blocked dates");
    }

    return {
        openDates: filteredOpenDates,
        blockedDates: blockedDates || []
    };
} 