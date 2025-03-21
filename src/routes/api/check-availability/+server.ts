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

// Cache for product availability data
interface AvailabilityCache {
    [productId: number]: {
        maxQuantity: number;
        availability: {
            [date: string]: {
                [minute: string]: number | null;
            };
        };
    };
}

interface AvailableTime {
    startTime: string;
    endTime: string;
}

interface AvailabilityResult {
    minute: number;
    isAvailable: boolean;
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

async function loadProductData(productId: number, dates: string[]) {
    // Get max quantity and availability data in parallel
    const [maxQuantityResult, ...availabilityResults] = await Promise.all([
        supabase
            .from('products')
            .select('total_quantity')
            .eq('id', productId)
            .single(),
        ...dates.map(date => supabase
            .from(`availability_product_${productId}`)
            .select('*')
            .eq('datum', date)
            .single())
    ]);

    const maxQuantity = maxQuantityResult.data?.total_quantity || 0;
    const availability: { [date: string]: { [minute: string]: number | null } } = {};

    // Process availability data
    dates.forEach((date, index) => {
        const result = availabilityResults[index];
        availability[date] = {};
        if (result.data) {
            Object.entries(result.data).forEach(([key, value]) => {
                if (key !== 'datum') {
                    availability[date][key] = value as number | null;
                }
            });
        }
    });

    return { maxQuantity, availability };
}

async function checkProductAvailability(
    cache: AvailabilityCache,
    productId: number,
    requestedQuantity: number,
    date: string,
    startMinute: number,
    endMinute: number,
    isDebug = false
): Promise<boolean> {
    const productData = cache[productId];
    if (!productData) {
        throw new Error(`Product ${productId} data not found in cache`);
    }

    const { maxQuantity, availability } = productData;
    const dateAvailability = availability[date];

    // If no availability data exists, all slots are available
    if (!dateAvailability) {
        return true;
    }

    // Check each 15-minute slot
    for (let minute = startMinute; minute < endMinute; minute += 15) {
        const minuteKey = minute.toString();
        const bookedQuantity = dateAvailability[minuteKey] === null ? 0 : Math.abs(dateAvailability[minuteKey] || 0);

        if (bookedQuantity + requestedQuantity > maxQuantity) {
            if (isDebug) {
                console.log(`  Not available at ${minutesToTime(minute)} - Booked: ${bookedQuantity}, Max: ${maxQuantity}, Requested: ${requestedQuantity}`);
            }
            return false;
        }
    }

    return true;
}

async function checkOvernightAvailability(
    cache: AvailabilityCache,
    startDate: string,
    durationValue: number,
    products: Array<{ productId: number; quantity: number }>,
    openTime: string,
    closeTime: string,
    startMinute: number
): Promise<boolean> {
    const dates: string[] = [];
    const startDateObj = parseISO(startDate);
    
    // Generate all required dates
    for (let i = 0; i < durationValue + 1; i++) {
        dates.push(format(addDays(startDateObj, i), 'yyyy-MM-dd'));
    }

    // Check all products in parallel
    const productChecks = products.map(async ({ productId, quantity }) => {
        // First day: check from start time to midnight
        const firstDayCheck = checkProductAvailability(
            cache,
            productId,
            quantity,
            dates[0],
            startMinute,
            24 * 60,
            true
        );

        // Middle days: check full days
        const middleDayChecks = dates.slice(1, -1).map(date =>
            checkProductAvailability(
                cache,
                productId,
                quantity,
                date,
                0,
                24 * 60,
                true
            )
        );

        // Last day: check from midnight to close time
        const lastDayCheck = checkProductAvailability(
            cache,
            productId,
            quantity,
            dates[dates.length - 1],
            0,
            timeToMinutes(closeTime),
            true
        );

        // Wait for all checks to complete
        const results = await Promise.all([firstDayCheck, ...middleDayChecks, lastDayCheck]);
        return results.every(result => result);
    });

    // Wait for all product checks to complete
    const results = await Promise.all(productChecks);
    return results.every(result => result);
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

        // Pre-load all required dates and product data
        const startDateObj = parseISO(date);
        const dates: string[] = [];
        for (let i = 0; i < (durationType === 'overnights' ? durationValue + 1 : 1); i++) {
            dates.push(format(addDays(startDateObj, i), 'yyyy-MM-dd'));
        }

        // Load all product data in parallel
        const cache: AvailabilityCache = {};
        await Promise.all(
            products.map(async ({ productId }) => {
                const data = await loadProductData(productId, dates);
                cache[productId] = data;
            })
        );

        const availableTimes: AvailableTime[] = [];
        const durationInMinutes = durationType === 'hours' ? durationValue * 60 : 0;
        const lastPossibleStartMinute = closeMinutes - durationInMinutes;

        if (durationType === 'overnights') {
            // Check all start times in parallel for overnight stays
            const checks: Promise<AvailabilityResult>[] = [];
            for (let currentMinute = openMinutes; currentMinute <= closeMinutes - 15; currentMinute += 15) {
                checks.push(
                    checkOvernightAvailability(
                        cache,
                        date,
                        durationValue,
                        products,
                        openTime,
                        closeTime,
                        currentMinute
                    ).then(isAvailable => ({
                        minute: currentMinute,
                        isAvailable
                    }))
                );
            }

            // Process results and add available times
            const results = await Promise.all(checks);
            results.forEach(({ minute, isAvailable }) => {
                if (isAvailable) {
                    availableTimes.push({
                        startTime: minutesToTime(minute),
                        endTime: closeTime
                    });
                }
            });
        } else {
            // Check all start times in parallel for regular bookings
            const checks: Promise<AvailabilityResult>[] = [];
            for (let currentMinute = openMinutes; currentMinute <= lastPossibleStartMinute; currentMinute += 15) {
                const endMinute = currentMinute + durationInMinutes;
                checks.push(
                    Promise.all(
                        products.map(({ productId, quantity }) =>
                            checkProductAvailability(
                                cache,
                                productId,
                                quantity,
                                date,
                                currentMinute,
                                endMinute,
                                true
                            )
                        )
                    ).then(results => ({
                        minute: currentMinute,
                        isAvailable: results.every(result => result)
                    }))
                );
            }

            // Process results and add available times
            const results = await Promise.all(checks);
            results.forEach(({ minute, isAvailable }) => {
                if (isAvailable) {
                    availableTimes.push({
                        startTime: minutesToTime(minute),
                        endTime: minutesToTime(minute + durationInMinutes)
                    });
                }
            });
        }

        console.log(`\nFound ${availableTimes.length} available time slots`);
        if (availableTimes.length > 0) {
            console.log('Available times:', availableTimes);
        }

        return json({ availableTimes });
    } catch (error) {
        console.error('Error checking availability:', error);
        throw error;
    }
}; 