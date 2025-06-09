import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';
import { addHours, addDays, parseISO, format } from 'date-fns';
import type { 
    AvailabilityRequest, 
    AvailabilityCache, 
    AvailableTime, 
    AvailabilityResult 
} from '$lib/types/availability';

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

// Get reserved quantities from pending bookings
async function getReservedQuantities(
    itemId: number, 
    itemType: 'product' | 'addon',
    dates: string[],
    excludeBookingNumber?: string
) {
    // Get all active reservations that haven't expired
    const { data: reservations, error } = await supabase
        .from('pending_bookings')
        .select('booking_number, booking_data, expires_at')
        .eq('availability_reserved', true)
        .gt('expires_at', new Date().toISOString());

    if (error) {
        console.error('Error fetching reservations:', error);
        return {};
    }

    const reservedQuantities: { [date: string]: { [minute: string]: number } } = {};

    // Initialize reserved quantities for all dates
    dates.forEach(date => {
        reservedQuantities[date] = {};
    });

    for (const reservation of reservations) {
        // Skip current user's own reservations
        if (excludeBookingNumber && reservation.booking_number === excludeBookingNumber) {
            continue;
        }

        // Check if reservation has expired (failsafe)
        if (new Date(reservation.expires_at) <= new Date()) {
            continue;
        }

        for (const bookingData of reservation.booking_data) {
            // Check if this booking affects our item
            let itemQuantity = 0;
            
            if (itemType === 'product') {
                const product = bookingData.products?.find((p: any) => p.productId === itemId);
                itemQuantity = product?.quantity || 0;
            } else {
                const addon = bookingData.addons?.find((a: any) => a.addonId === itemId);
                itemQuantity = addon?.quantity || 0;
            }

            if (itemQuantity === 0) continue;

            // Get duration details to calculate affected dates
            const { data: durationData } = await supabase
                .from('durations')
                .select('duration_type, duration_value')
                .eq('id', bookingData.durationId)
                .single();

            const isOvernight = durationData?.duration_type === 'overnights';
            const startDate = bookingData.startDate;
            const startTime = bookingData.startTime;
            const endTime = bookingData.endTime;
            
            // Calculate affected dates
            let affectedDates = [startDate];
            if (isOvernight && durationData) {
                const endDate = format(addDays(parseISO(startDate), durationData.duration_value), 'yyyy-MM-dd');
                const current = parseISO(startDate);
                const end = parseISO(endDate);
                affectedDates = [];
                let currentDate = current;
                while (currentDate <= end) {
                    affectedDates.push(format(currentDate, 'yyyy-MM-dd'));
                    currentDate = addDays(currentDate, 1);
                }
            }

            // Add reserved quantities to affected time slots
            affectedDates.forEach((date, index) => {
                if (!dates.includes(date)) return; // Only process dates we're checking

                if (!reservedQuantities[date]) {
                    reservedQuantities[date] = {};
                }

                let dayStartMinutes, dayEndMinutes;
                
                if (isOvernight) {
                    if (index === 0) {
                        // First day: from start time to midnight
                        dayStartMinutes = timeToMinutes(startTime);
                        dayEndMinutes = 24 * 60;
                    } else if (index === affectedDates.length - 1) {
                        // Last day: from midnight to end time
                        dayStartMinutes = 0;
                        dayEndMinutes = timeToMinutes(endTime);
                    } else {
                        // Middle days: full day
                        dayStartMinutes = 0;
                        dayEndMinutes = 24 * 60;
                    }
                } else {
                    // Regular booking: from start time to end time
                    dayStartMinutes = timeToMinutes(startTime);
                    dayEndMinutes = timeToMinutes(endTime);
                }

                // Add to each 15-minute slot
                for (let minute = dayStartMinutes; minute < dayEndMinutes; minute += 15) {
                    const slotKey = minute.toString();
                    reservedQuantities[date][slotKey] = (reservedQuantities[date][slotKey] || 0) + itemQuantity;
                }
            });
        }
    }

    return reservedQuantities;
}

async function loadProductData(productId: number, dates: string[], excludeBookingNumber?: string) {
    // Get max quantity and availability data in parallel
    const [maxQuantityResult, reservedQuantities, ...availabilityResults] = await Promise.all([
        supabase
            .from('products')
            .select('total_quantity')
            .eq('id', productId)
            .single(),
        getReservedQuantities(productId, 'product', dates, excludeBookingNumber),
        ...dates.map(date => supabase
            .from(`availability_product_${productId}`)
            .select('*')
            .eq('datum', date)
            .single())
    ]);

    const maxQuantity = maxQuantityResult.data?.total_quantity || 0;
    const availability: { [date: string]: { [minute: string]: number | null } } = {};

    // Process availability data and add reserved quantities
    dates.forEach((date, index) => {
        const result = availabilityResults[index];
        availability[date] = {};
        
        // Start with existing availability data
        if (result.data) {
            Object.entries(result.data).forEach(([key, value]) => {
                if (key !== 'datum') {
                    availability[date][key] = value as number | null;
                }
            });
        }

        // Add reserved quantities
        const dateReserved = reservedQuantities[date] || {};
        Object.entries(dateReserved).forEach(([minute, reservedQty]) => {
            const currentValue = availability[date][minute] || 0;
            availability[date][minute] = currentValue + reservedQty;
        });
    });

    return { maxQuantity, availability, type: 'product' as const, trackAvailability: true };
}

async function loadAddonData(addonId: number, dates: string[], excludeBookingNumber?: string) {
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

    // Get reserved quantities and availability data
    const [reservedQuantities, ...availabilityResults] = await Promise.all([
        getReservedQuantities(addonId, 'addon', dates, excludeBookingNumber),
        ...dates.map(date => supabase
            .from(`availability_addon_${addonId}`)
            .select('*')
            .eq('datum', date)
            .single())
    ]);

    // Process availability data and add reserved quantities
    const availability: { [date: string]: { [minute: string]: number | null } } = {};
    dates.forEach((date, index) => {
        const result = availabilityResults[index];
        availability[date] = {};
        
        // Start with existing availability data
        if (result.data) {
            Object.entries(result.data).forEach(([key, value]) => {
                if (key !== 'datum') {
                    availability[date][key] = value as number | null;
                }
            });
        }

        // Add reserved quantities
        const dateReserved = reservedQuantities[date] || {};
        Object.entries(dateReserved).forEach(([minute, reservedQty]) => {
            const currentValue = availability[date][minute] || 0;
            availability[date][minute] = currentValue + reservedQty;
        });
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
        const requestData: AvailabilityRequest & { excludeBookingNumber?: string } = await request.json();
        const { date, durationType, durationValue, products, addons = [], experienceId, excludeBookingNumber } = requestData;
                
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

        // Load all product and addon data in parallel (including reserved quantities)
        const cache: AvailabilityCache = {};
        
        const loadPromises = [
            ...products.map(async ({ productId }) => {
                const data = await loadProductData(productId, dates, excludeBookingNumber);
                cache[productId] = data;
            }),
            ...addons.map(async ({ addonId }) => {
                const data = await loadAddonData(addonId, dates, excludeBookingNumber);
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