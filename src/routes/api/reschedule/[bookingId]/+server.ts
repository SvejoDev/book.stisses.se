import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';
import type { BookingProduct } from '$lib/types/product';
import type { BookingAddon } from '$lib/types/addon';
import type { BookingPriceGroup } from '$lib/types/price';

export const GET: RequestHandler = async ({ params }) => {
    try {
        const { bookingId } = params;
        
        if (!bookingId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
            return json({ error: 'Invalid booking ID format' }, { status: 400 });
        }

        // Fetch booking details with all related data
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
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
            .eq('id', bookingId)
            .single();

        if (bookingError) {
            return json({ error: 'Failed to fetch booking' }, { status: 500 });
        }

        if (!booking) {
            return json({ error: 'Booking not found' }, { status: 404 });
        }

        // Check if booking has guarantee
        if (!booking.has_booking_guarantee) {
            return json({ error: 'This booking does not have rebooking guarantee' }, { status: 403 });
        }

        // Check if booking is within valid time frame (more than 24h before start)
        const startDateTime = new Date(`${booking.start_date}T${booking.start_time}`);
        const now = new Date();
        const hoursUntilStart = (startDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

        if (hoursUntilStart <= 24) {
            return json({ error: 'Rebooking must be done at least 24 hours before the start time' }, { status: 403 });
        }

        // Return booking details
        return json({
            booking: {
                id: booking.id,
                experienceId: booking.experience_id,
                experienceType: booking.experience_type,
                startLocationId: booking.start_location_id,
                durationId: booking.duration_id,
                startDate: booking.start_date,
                startTime: booking.start_time,
                endDate: booking.end_date,
                endTime: booking.end_time,
                products: booking.booking_products.map((p: BookingProduct) => ({
                    productId: p.products.id,
                    quantity: p.quantity,
                    name: p.products.name,
                    totalQuantity: p.products.total_quantity
                })),
                addons: booking.booking_addons.map((a: BookingAddon) => ({
                    addonId: a.addons.id,
                    quantity: a.quantity,
                    name: a.addons.name,
                    totalQuantity: a.addons.total_quantity,
                    trackAvailability: a.addons.track_availability
                })),
                priceGroups: booking.booking_price_groups.map((pg: BookingPriceGroup) => ({
                    priceGroupId: pg.price_groups.id,
                    quantity: pg.quantity,
                    name: pg.price_groups.display_name
                })),
                duration: {
                    type: booking.duration.duration_type,
                    value: booking.duration.duration_value,
                    extraPrice: booking.duration.extra_price
                },
                experience: {
                    name: booking.experience.name,
                    bookingForesightHours: booking.experience.booking_foresight_hours
                }
            }
        });
    } catch (error) {
        return json({ error: 'Internal server error' }, { status: 500 });
    }
}; 