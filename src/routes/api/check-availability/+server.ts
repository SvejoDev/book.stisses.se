import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';
import { addHours } from 'date-fns';

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

async function getOpeningHours(experienceId: number, date: string) {
    // First try to find a specific date entry
    let { data, error } = await supabase
        .from('experience_open_dates')
        .select('open_time, close_time')
        .eq('experience_id', experienceId)
        .eq('type', 'specific')
        .eq('specific_date', date)
        .single();
    
    if (!data) {
        // If no specific date found, look for an interval that includes this date
        ({ data, error } = await supabase
            .from('experience_open_dates')
            .select('open_time, close_time')
            .eq('experience_id', experienceId)
            .eq('type', 'interval')
            .lte('start_date', date)
            .gte('end_date', date)
            .single());
    }
    
    if (error) throw error;
    if (!data) throw new Error('No opening hours found for this date');
    
    return {
        openTime: data.open_time,
        closeTime: data.close_time
    };
}

function timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
}

function minutesToTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

async function checkProductAvailability(
    productId: number,
    date: string,
    requestedQuantity: number,
    startMinute: number,
    endMinute: number
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
    for (let minute = startMinute; minute <= endMinute; minute += 15) {
        const currentlyBooked = Math.abs(availability[minute.toString()] || 0);
        if (currentlyBooked + requestedQuantity > maxQuantity) {
            return false;
        }
    }

    return true;
}

export const POST: RequestHandler = async ({ request }) => {
    try {
        const requestData: AvailabilityRequest = await request.json();
        console.log('Received request:', requestData);

        const { date, durationType, durationValue, products, experienceId } = requestData;

        // Get opening hours for the date
        const { openTime, closeTime } = await getOpeningHours(experienceId, date);
        console.log('Opening hours:', { openTime, closeTime });

        // Convert times to minutes
        const openMinutes = timeToMinutes(openTime);
        const closeMinutes = timeToMinutes(closeTime);
        
        // Calculate last possible start time based on duration
        const durationInMinutes = durationType === 'hours' ? durationValue * 60 : closeMinutes - openMinutes;
        const lastPossibleStartMinute = closeMinutes - durationInMinutes;

        console.log('Time calculations:', {
            openMinutes,
            closeMinutes,
            durationInMinutes,
            lastPossibleStartMinute
        });

        const availableTimes = [];

        // Check every 15-minute interval
        for (let currentMinute = openMinutes; currentMinute <= lastPossibleStartMinute; currentMinute += 15) {
            const endMinute = currentMinute + durationInMinutes;
            
            // Check availability for all products
            let isTimeSlotAvailable = true;
            for (const { productId, quantity } of products) {
                const isAvailable = await checkProductAvailability(
                    productId,
                    date,
                    quantity,
                    currentMinute,
                    endMinute
                );

                if (!isAvailable) {
                    isTimeSlotAvailable = false;
                    break;
                }
            }

            if (isTimeSlotAvailable) {
                availableTimes.push({
                    startTime: minutesToTime(currentMinute),
                    endTime: minutesToTime(endMinute)
                });
            }
        }

        console.log('Available times:', availableTimes);
        return json(availableTimes);
    } catch (error) {
        console.error('Error in check-availability:', error);
        return new Response(error instanceof Error ? error.message : 'An error occurred', { status: 500 });
    }
}; 