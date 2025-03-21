import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';
import { addHours, addDays, parseISO, format } from 'date-fns';

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
    endMinute: number,
    isDebug: boolean = false
) {
    if (isDebug) {
        console.log(`Checking availability for ${date} from ${minutesToTime(startMinute)} to ${minutesToTime(endMinute)}`);
    }

    const { data: product } = await supabase
        .from('products')
        .select('total_quantity')
        .eq('id', productId)
        .single();

    if (!product) throw new Error(`Product ${productId} not found`);
    const maxQuantity = product.total_quantity;

    const { data: availability } = await supabase
        .from(`availability_product_${productId}`)
        .select('*')
        .eq('datum', date)
        .single();

    // If no availability data found, it means no bookings (all slots available)
    if (!availability) return true;

    for (let minute = startMinute; minute <= endMinute; minute += 15) {
        const minuteKey = minute.toString();
        // If the slot is NULL or undefined, treat it as 0 bookings
        const bookedQuantity = availability[minuteKey] === null ? 0 : Math.abs(availability[minuteKey] || 0);
        
        if (isDebug) {
            console.log(`Slot ${minutesToTime(minute)}:`, {
                booked: bookedQuantity,
                available: maxQuantity - bookedQuantity,
                requested: requestedQuantity
            });
        }

        if (bookedQuantity + requestedQuantity > maxQuantity) {
            if (isDebug) {
                console.log(`Not available at ${minutesToTime(minute)} - Booked: ${bookedQuantity}, Available: ${maxQuantity - bookedQuantity}`);
            }
            return false;
        }
    }

    return true;
}

async function checkOvernightAvailability(
    startDate: string,
    durationValue: number,
    products: Array<{ productId: number; quantity: number }>,
    openTime: string,
    closeTime: string,
    startMinute: number
) {
    const dates = [];
    const startDateObj = parseISO(startDate);
    
    // Generate all dates we need to check
    for (let i = 0; i < durationValue + 1; i++) {
        dates.push(format(addDays(startDateObj, i), 'yyyy-MM-dd'));
    }

    for (const { productId, quantity } of products) {
        // Check first day (from startMinute to midnight)
        const firstDayAvailable = await checkProductAvailability(
            productId,
            dates[0],
            quantity,
            startMinute,
            1440, // 23:59
            true
        );
        if (!firstDayAvailable) return false;

        // Check middle days if any (full days)
        for (let i = 1; i < dates.length - 1; i++) {
            const fullDayAvailable = await checkProductAvailability(
                productId,
                dates[i],
                quantity,
                0, // 00:00
                1440, // 23:59
                true
            );
            if (!fullDayAvailable) return false;
        }

        // Check last day (midnight to closeTime)
        const lastDayAvailable = await checkProductAvailability(
            productId,
            dates[dates.length - 1],
            quantity,
            0, // 00:00
            timeToMinutes(closeTime),
            true
        );
        if (!lastDayAvailable) return false;
    }

    return true;
}

export const POST: RequestHandler = async ({ request }) => {
    try {
        const requestData: AvailabilityRequest = await request.json();
        const { date, durationType, durationValue, products, experienceId } = requestData;
        
        const { openTime, closeTime } = await getOpeningHours(experienceId, date);
        const openMinutes = timeToMinutes(openTime);
        const closeMinutes = timeToMinutes(closeTime);
        
        console.log('\nProcessing availability request:', {
            date,
            durationType,
            durationValue,
            products
        });

        const availableTimes = [];

        if (durationType === 'overnights') {
            // For overnight stays, check each start time
            for (let currentMinute = openMinutes; currentMinute <= closeMinutes - 15; currentMinute += 15) {
                console.log(`\nChecking availability for start time: ${minutesToTime(currentMinute)}`);
                
                const isAvailable = await checkOvernightAvailability(
                    date,
                    durationValue,
                    products,
                    openTime,
                    closeTime,
                    currentMinute
                );

                if (isAvailable) {
                    availableTimes.push({
                        startTime: minutesToTime(currentMinute),
                        endTime: closeTime
                    });
                }
            }
        } else {
            // Regular hourly bookings (existing logic)
            const durationInMinutes = durationValue * 60;
            const lastPossibleStartMinute = closeMinutes - durationInMinutes;

            for (let currentMinute = openMinutes; currentMinute <= lastPossibleStartMinute; currentMinute += 15) {
                const endMinute = currentMinute + durationInMinutes;
                
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
        }

        console.log(`\nFound ${availableTimes.length} available time slots:`, availableTimes);
        return json(availableTimes);
    } catch (error) {
        console.error('Error in check-availability:', error);
        return new Response(error instanceof Error ? error.message : 'An error occurred', { status: 500 });
    }
}; 