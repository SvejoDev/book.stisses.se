import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';

interface AvailabilityRequest {
    date: string;
    durationType: 'hours' | 'overnights';
    durationValue: number;
    products: Array<{
        productId: number;
        quantity: number;
    }>;
    experienceId: number;
}

interface AvailableTime {
    startTime: string;  // Format: "HH:mm"
    endTime: string;    // Format: "HH:mm"
}

async function getOpeningHours(experienceId: number, date: string) {
    const { data, error } = await supabase
        .from('experience_open_dates')
        .select('open_time, close_time')
        .eq('experience_id', experienceId)
        .eq('specific_date', date)
        .single();
    
    if (error) throw error;
    return {
        openTime: data.open_time,
        closeTime: data.close_time
    };
}

async function checkProductAvailability(
    productId: number,
    date: string,
    requestedQuantity: number,
    startSlot: number,
    endSlot: number
) {
    // Get product's max quantity
    const { data: product } = await supabase
        .from('products')
        .select('total_quantity')
        .eq('id', productId)
        .single();

    if (!product) throw new Error(`Product ${productId} not found`);
    const maxQuantity = product.total_quantity;

    // Get availability for the date
    const { data: availability } = await supabase
        .from(`availability_product_${productId}`)
        .select('*')
        .eq('datum', date)
        .single();

    if (!availability) {
        // No bookings for this date, all slots are available
        return true;
    }

    // Check each 15-minute slot
    for (let slot = startSlot; slot <= endSlot; slot++) {
        const currentlyBooked = Math.abs(availability[slot] || 0);
        if (currentlyBooked + requestedQuantity > maxQuantity) {
            return false;
        }
    }

    return true;
}

export const GET: RequestHandler = async ({ url }) => {
    const startLocationId = url.searchParams.get('startLocationId');
    
    if (!startLocationId) {
        return new Response('Start location ID is required', { status: 400 });
    }

    try {
        const { data, error } = await supabase
            .from('start_location_durations')
            .select(`
                durations (
                    id,
                    duration_type,
                    duration_value,
                    extra_price
                )
            `)
            .eq('start_location_id', startLocationId);

        if (error) throw error;

        // Transform the data to match the expected format
        const durations = data?.map(item => item.durations).filter(Boolean) || [];
        
        return json(durations);
    } catch (error) {
        console.error('Error fetching durations:', error);
        return new Response('Failed to fetch durations', { status: 500 });
    }
};