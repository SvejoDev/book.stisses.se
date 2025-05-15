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
    addons?: Array<{
        addonId: number;
        quantity: number;
    }>;
    experienceId: number;
}

// Cache for product/addon availability data
interface AvailabilityCache {
    [id: number]: {
        maxQuantity: number;
        availability: {
            [date: string]: {
                [minute: string]: number | null;
            };
        };
        type: 'product' | 'addon';
        trackAvailability: boolean;
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

    return { maxQuantity, availability, type: 'product' as const, trackAvailability: true };
}

async function loadAddonData(addonId: number, dates: string[]) {
    // First check if addon needs availability tracking
    const { data: addon, error: addonError } = await supabase
        .from('addons')
        .select('total_quantity, track_availability')
        .eq('id', addonId)
        .single();

    if (addonError) throw addonError;

    // If addon doesn't track availability, return simplified data
    if (!addon.track_availability) {
        return {
            maxQuantity: addon.total_quantity,
            availability: {}, // Empty availability means always available
            type: 'addon' as const,
            trackAvailability: false
        };
    }

    // Rest of your existing loadAddonData code for tracked addons
    const availabilityResults = await Promise.all(
        dates.map(date => supabase
            .from(`availability_addon_${addonId}`)
            .select('*')
            .eq('datum', date)
            .single())
    );

    // Process availability data as before
    const availability: { [date: string]: { [minute: string]: number | null } } = {};
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

    return {
        maxQuantity: addon.total_quantity,
        availability,
        type: 'addon' as const,
        trackAvailability: true
    };
}

async function checkItemAvailability(
    cache: AvailabilityCache,
    itemId: number,
    requestedQuantity: number,
    date: string,
    startMinute: number,
    endMinute: number,
    isDebug = false
): Promise<boolean> {
    const itemData = cache[itemId];
    if (!itemData) {
        throw new Error(`Item ${itemId} data not found in cache`);
    }

    const { maxQuantity, availability, type, trackAvailability } = itemData;

    // If item doesn't track availability, it's always available
    if (!trackAvailability) {
        return true;
    }

    const dateAvailability = availability[date];
    if (!dateAvailability) {
        return true;
    }

    // Check each 15-minute slot
    for (let minute = startMinute; minute < endMinute; minute += 15) {
        const minuteKey = minute.toString();
        const bookedQuantity = dateAvailability[minuteKey] === null ? 0 : Math.abs(dateAvailability[minuteKey] || 0);
        const wouldBeBooked = bookedQuantity + requestedQuantity;

        if (wouldBeBooked > maxQuantity) {
            return false;
        }
    }

    return true;
}

async function checkOvernightAvailability(
    cache: AvailabilityCache,
    startDate: string,
    durationValue: number,
    items: Array<{ id: number; quantity: number; type: 'product' | 'addon' }>,
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

    // Check all items in parallel
    const itemChecks = items.map(async ({ id, quantity }) => {
        // First day: check from start time to midnight
        const firstDayCheck = checkItemAvailability(
            cache,
            id,
            quantity,
            dates[0],
            startMinute,
            24 * 60,
            true
        );

        // Middle days: check full days
        const middleDayChecks = dates.slice(1, -1).map(date =>
            checkItemAvailability(
                cache,
                id,
                quantity,
                date,
                0,
                24 * 60,
                true
            )
        );

        // Last day: check from midnight to close time
        const lastDayCheck = checkItemAvailability(
            cache,
            id,
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

    // Wait for all item checks to complete
    const results = await Promise.all(itemChecks);
    return results.every(result => result);
}

export const POST: RequestHandler = async ({ request }) => {
    try {
        const requestData: AvailabilityRequest = await request.json();
        const { date, durationType, durationValue, products, addons = [], experienceId } = requestData;
                
        // Get experience details including booking foresight
        const { data: experience, error: experienceError } = await supabase
            .from('experiences')
            .select('booking_foresight_hours')
            .eq('id', experienceId)
            .single();

        if (experienceError) throw new Error('Failed to fetch experience details');
        
        const { openTime, closeTime } = await getOpeningHours(experienceId, date);
        const openMinutes = timeToMinutes(openTime);
        const closeMinutes = timeToMinutes(closeTime);
  

        // Handle booking foresight
        const now = new Date();
        const requestedDate = parseISO(date);
        const foresightMilliseconds = (experience.booking_foresight_hours || 0) * 60 * 60 * 1000;
        const foresightDate = new Date(now.getTime() + foresightMilliseconds);

     

        // If the requested date is within the foresight period, we need to block times before foresight
        let effectiveOpenMinutes = openMinutes;
        if (requestedDate <= foresightDate) {
            // Calculate the current time in minutes since midnight
            const currentMinutes = (now.getHours() * 60) + now.getMinutes();
            
            // Round up to next 15-minute interval
            const roundedCurrentMinutes = Math.ceil((currentMinutes + 1) / 15) * 15;
            
            // Calculate how many minutes into the next day we need to block
            const minutesIntoNextDay = roundedCurrentMinutes + (experience.booking_foresight_hours * 60);
            const adjustedForesightMinutes = minutesIntoNextDay % (24 * 60); // Wrap around to next day

        
            
            // If booking for next day, use the wrapped around minutes
            if (requestedDate.getDate() !== now.getDate()) {
                effectiveOpenMinutes = Math.max(openMinutes, adjustedForesightMinutes);
            } else {
                effectiveOpenMinutes = Math.max(openMinutes, roundedCurrentMinutes + (experience.booking_foresight_hours * 60));
            }

        }

        // Pre-load all required dates
        const startDateObj = parseISO(date);
        const dates: string[] = [];
        for (let i = 0; i < (durationType === 'overnights' ? durationValue + 1 : 1); i++) {
            dates.push(format(addDays(startDateObj, i), 'yyyy-MM-dd'));
        }

        // Load all product and addon data in parallel
        const cache: AvailabilityCache = {};
        
        const loadPromises = [
            ...products.map(async ({ productId }) => {
                const data = await loadProductData(productId, dates);
                cache[productId] = data;
            }),
            ...addons.map(async ({ addonId }) => {
                const data = await loadAddonData(addonId, dates);
                cache[addonId] = data;
            })
        ];
        
        await Promise.all(loadPromises);

        const availableTimes: AvailableTime[] = [];
        const durationInMinutes = durationType === 'hours' ? durationValue * 60 : 0;
        const lastPossibleStartMinute = closeMinutes - durationInMinutes;

        // Combine products and addons into a single array for availability checking
        const allItems = [
            ...products.map(p => ({ id: p.productId, quantity: p.quantity, type: 'product' as const })),
            ...addons.map(a => ({ id: a.addonId, quantity: a.quantity, type: 'addon' as const }))
        ];

        if (durationType === 'overnights') {
            // Check all start times in parallel for overnight stays
            const checks: Promise<AvailabilityResult>[] = [];
            for (let currentMinute = effectiveOpenMinutes; currentMinute <= closeMinutes - 15; currentMinute += 15) {
                checks.push(
                    checkOvernightAvailability(
                        cache,
                        date,
                        durationValue,
                        allItems,
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
            for (let currentMinute = effectiveOpenMinutes; currentMinute <= lastPossibleStartMinute; currentMinute += 15) {
                const endMinute = currentMinute + durationInMinutes;
                
                const itemChecks = allItems.map(({ id, quantity }) => 
                    checkItemAvailability(
                        cache,
                        id,
                        quantity,
                        date,
                        currentMinute,
                        endMinute,
                        true
                    )
                );
                
                checks.push(
                    Promise.all(itemChecks).then(results => ({
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

        if (availableTimes.length > 0) {
        }

        return json({ availableTimes });
    } catch (error) {
        throw error;
    }
}; 