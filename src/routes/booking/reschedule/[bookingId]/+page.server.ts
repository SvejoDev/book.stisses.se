import { supabaseServer } from "$lib/supabaseServerClient";
import { error } from '@sveltejs/kit';

// Local types that match the database query structure
interface OpenDateQuery {
    type: 'interval' | 'specific';
    start_date: string | null;
    end_date: string | null;
    specific_date: string | null;
}

interface BlockedDateQuery {
    start_date: string;
    end_date: string;
}

export async function load({ params }) {
    const { bookingId } = params;
    
    // Validate booking ID format
    if (!bookingId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
        throw error(400, "Invalid booking ID");
    }

    const today = new Date().toISOString().split('T')[0];

    // First get the booking with its direct relations
    const { data: bookingData, error: bookingError } = await supabaseServer
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

    if (bookingError) {
        throw error(500, "Error fetching booking");
    }

    if (!bookingData) {
        throw error(404, "Booking not found");
    }

    // Then get the open and blocked dates for the experience
    const { data: experienceDates, error: datesError } = await supabaseServer
        .from("experiences")
        .select(`
            open_dates:experience_open_dates (
                type,
                start_date,
                end_date,
                specific_date
            ),
            blocked_dates:experience_blocked_dates (
                start_date,
                end_date
            )
        `)
        .eq("id", bookingData.experience_id)
        .single();

    if (datesError) {
        throw error(500, "Error fetching experience dates");
    }

    // Filter open dates to only include future dates
    const filteredOpenDates = (experienceDates?.open_dates || []).filter((date: OpenDateQuery) => {
        if (date.type === 'interval') {
            return date.end_date && date.end_date >= today;
        } else {
            return date.specific_date && date.specific_date >= today;
        }
    });

    // Filter blocked dates to only include future dates
    const filteredBlockedDates = (experienceDates?.blocked_dates || []).filter((date: BlockedDateQuery) => {
        return date.end_date >= today;
    });

    return {
        booking: bookingData,
        openDates: filteredOpenDates,
        blockedDates: filteredBlockedDates
    };
} 