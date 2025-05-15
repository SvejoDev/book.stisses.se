import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';
import { supabaseServer } from '$lib/supabaseServerClient';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import type { BookingProduct, BookingAddon } from './[bookingId]/+server';
import { addDays, parseISO, format } from 'date-fns';

interface AvailabilityUpdate {
    tableName: string;
    date: string;
    startMinutes: number;
    endMinutes: number;
    quantity: number;
    maxQuantity: number;
}

// Cache for availability data
const availabilityCache = new Map<string, Map<string, number>>();

// Cache for booking data
const bookingCache = new Map<string, any>();

// Helper function to generate dates between start and end date
function generateDateRange(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    
    let current = start;
    while (current <= end) {
        dates.push(format(current, 'yyyy-MM-dd'));
        current = addDays(current, 1);
    }
    
    return dates;
}

// Helper function to get or create cache key
function getCacheKey(tableName: string, date: string): string {
    return `${tableName}_${date}`;
}

// Helper function to load availability data into cache
async function loadAvailabilityIntoCache(tableName: string, dates: string[]) {
    const { data, error } = await supabaseServer
        .from(tableName)
        .select('*')
        .in('datum', dates);

    if (error) throw error;

    // Initialize cache for all dates, even if they don't exist in the database
    for (const date of dates) {
        const cacheKey = getCacheKey(tableName, date);
        if (!availabilityCache.has(cacheKey)) {
            // Initialize with all time slots set to 0
            const initialSlots = new Map<string, number>();
            for (let i = 0; i <= 1440; i += 15) {
                initialSlots.set(i.toString(), 0);
            }
            availabilityCache.set(cacheKey, initialSlots);
        }
    }

    // Update cache with existing data
    if (data) {
        for (const row of data) {
            const cacheKey = getCacheKey(tableName, row.datum);
            const slotMap = new Map<string, number>();
            Object.entries(row).forEach(([key, value]) => {
                if (key !== 'datum') {
                    slotMap.set(key, value as number);
                }
            });
            availabilityCache.set(cacheKey, slotMap);
        }
    }
}

// Helper function to get availability from cache
function getAvailabilityFromCache(tableName: string, date: string, minute: string): number {
    const cacheKey = getCacheKey(tableName, date);
    const slotMap = availabilityCache.get(cacheKey);
    return slotMap?.get(minute) || 0;
}

// Helper function to update cache
function updateCache(tableName: string, date: string, updates: Record<string, number>): void {
    const cacheKey = getCacheKey(tableName, date);
    let slotMap = availabilityCache.get(cacheKey);
    
    if (!slotMap) {
        slotMap = new Map<string, number>();
        availabilityCache.set(cacheKey, slotMap);
    }

    Object.entries(updates).forEach(([minute, value]) => {
        slotMap!.set(minute, value);
    });
}

// Helper function to get booking data with caching
async function getBookingData(bookingId: string) {
    if (bookingCache.has(bookingId)) {
        return bookingCache.get(bookingId);
    }

    const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .select(`
            *,
            booking_products (
                quantity,
                products (
                    id,
                    total_quantity
                )
            ),
            booking_addons (
                quantity,
                addons (
                    id,
                    total_quantity,
                    track_availability
                )
            ),
            duration:durations (
                duration_type,
                duration_value
            )
        `)
        .eq('id', bookingId)
        .single();

    if (bookingError || !booking) {
        throw new Error('Booking not found');
    }

    bookingCache.set(bookingId, booking);
    return booking;
}

async function updateAvailability(updates: AvailabilityUpdate[], isSubtract: boolean = false) {
    // Group updates by table and date for batch processing
    const groupedUpdates = new Map<string, Map<string, Record<string, number>>>();
    
    // Clear cache for all affected dates to ensure fresh data
    for (const update of updates) {
        const cacheKey = getCacheKey(update.tableName, update.date);
        availabilityCache.delete(cacheKey);
    }
    
    // First load all dates into cache
    const uniqueDates = new Set(updates.map(u => u.date));
    for (const update of updates) {
        await loadAvailabilityIntoCache(update.tableName, Array.from(uniqueDates));
    }
    
    for (const update of updates) {
        const { tableName, date, startMinutes, endMinutes, quantity, maxQuantity } = update;
        
        if (!groupedUpdates.has(tableName)) {
            groupedUpdates.set(tableName, new Map());
        }
        
        const dateMap = groupedUpdates.get(tableName)!;
        if (!dateMap.has(date)) {
            // Initialize with current values from cache
            const currentSlots = new Map<string, number>();
            for (let i = 0; i <= 1440; i += 15) {
                const slotKey = i.toString();
                currentSlots.set(slotKey, getAvailabilityFromCache(tableName, date, slotKey));
            }
            dateMap.set(date, Object.fromEntries(currentSlots));
        }
        
        const dateUpdates = dateMap.get(date)!;
        
        // Generate updates for all time slots
        for (let minute = startMinutes; minute <= endMinutes; minute += 15) {
            const slotKey = minute.toString();
            const currentValue = getAvailabilityFromCache(tableName, date, slotKey);
            let newValue;
            if (isSubtract) {
                newValue = Math.max(0, currentValue - quantity);
            } else {
                newValue = Math.min(maxQuantity, currentValue + quantity);
            }
            dateUpdates[slotKey] = newValue;
        }
    }

    // Process all updates in parallel
    const updatePromises: Promise<void>[] = [];
    
    for (const [tableName, dateMap] of groupedUpdates) {
        for (const [date, updates] of dateMap) {
            // Update cache
            updateCache(tableName, date, updates);
            
            // Create update promise
            updatePromises.push(
                (async () => {
                    // Ensure date exists and update in a single operation
                    const { error: updateError } = await supabaseServer
                        .from(tableName)
                        .upsert({
                            datum: date,
                            ...updates
                        }, {
                            onConflict: 'datum'
                        });

                    if (updateError) {
                        throw updateError;
                    }
                })()
            );
        }
    }

    // Wait for all updates to complete
    await Promise.all(updatePromises);
}

export const POST: RequestHandler = async ({ request }) => {
    try {
        const { bookingId, newDate, newStartTime, newEndTime, reason } = await request.json();

        // Clear booking cache to fetch the latest booking state
        bookingCache.delete(bookingId);

        // Get booking data from cache or database
        const booking = await getBookingData(bookingId);

        // Convert times to minutes
        const oldStartMinutes = parseInt(booking.start_time.split(':')[0]) * 60 + parseInt(booking.start_time.split(':')[1]);
        const oldEndMinutes = parseInt(booking.end_time.split(':')[0]) * 60 + parseInt(booking.end_time.split(':')[1]);
        const newStartMinutes = parseInt(newStartTime.split(':')[0]) * 60 + parseInt(newStartTime.split(':')[1]);
        const newEndMinutes = parseInt(newEndTime.split(':')[0]) * 60 + parseInt(newEndTime.split(':')[1]);

        // Check if it's an overnight booking
        const isOvernight = booking.duration.duration_type === 'overnights';

        // Always compute oldEndDate for overnight bookings
        let oldEndDate: string;
        if (isOvernight) {
            oldEndDate = format(addDays(parseISO(booking.start_date), booking.duration.duration_value), 'yyyy-MM-dd');
        } else {
            oldEndDate = booking.end_date;
        }
        const oldDates = generateDateRange(booking.start_date, oldEndDate);
        const newEndDate = isOvernight 
            ? format(addDays(parseISO(newDate), booking.duration.duration_value), 'yyyy-MM-dd')
            : newDate;

        // Clear cache for all affected dates
        const allDates = [...oldDates, newDate];
        if (isOvernight) {
            allDates.push(newEndDate);
        }
        for (const date of allDates) {
            for (const bookingProduct of booking.booking_products) {
                const tableName = `availability_product_${bookingProduct.products.id}`;
                const cacheKey = getCacheKey(tableName, date);
                availabilityCache.delete(cacheKey);
            }
            for (const bookingAddon of booking.booking_addons) {
                if (bookingAddon.addons.track_availability) {
                    const tableName = `availability_addon_${bookingAddon.addons.id}`;
                    const cacheKey = getCacheKey(tableName, date);
                    availabilityCache.delete(cacheKey);
                }
            }
        }

        const subtractionUpdates: AvailabilityUpdate[] = [];
        const additionUpdates: AvailabilityUpdate[] = [];

        // Products
        for (const bookingProduct of booking.booking_products) {
            const tableName = `availability_product_${bookingProduct.products.id}`;
            // Subtract for old dates
            if (isOvernight) {
                // First day: from start time to midnight
                subtractionUpdates.push({
                    tableName,
                    date: oldDates[0],
                    startMinutes: oldStartMinutes,
                    endMinutes: 24 * 60,
                    quantity: bookingProduct.quantity,
                    maxQuantity: bookingProduct.products.total_quantity
                });
                // Middle days: full days
                for (let i = 1; i < oldDates.length - 1; i++) {
                    subtractionUpdates.push({
                        tableName,
                        date: oldDates[i],
                        startMinutes: 0,
                        endMinutes: 24 * 60,
                        quantity: bookingProduct.quantity,
                        maxQuantity: bookingProduct.products.total_quantity
                    });
                }
                // Last day: from midnight to end time
                subtractionUpdates.push({
                    tableName,
                    date: oldDates[oldDates.length - 1],
                    startMinutes: 0,
                    endMinutes: oldEndMinutes,
                    quantity: bookingProduct.quantity,
                    maxQuantity: bookingProduct.products.total_quantity
                });
            } else {
                subtractionUpdates.push({
                    tableName,
                    date: booking.start_date,
                    startMinutes: oldStartMinutes,
                    endMinutes: oldEndMinutes,
                    quantity: bookingProduct.quantity,
                    maxQuantity: bookingProduct.products.total_quantity
                });
            }
            // Add for new dates
            if (isOvernight) {
                const newDates = generateDateRange(newDate, newEndDate);
                additionUpdates.push({
                    tableName,
                    date: newDate,
                    startMinutes: newStartMinutes,
                    endMinutes: 24 * 60,
                    quantity: bookingProduct.quantity,
                    maxQuantity: bookingProduct.products.total_quantity
                });
                for (let i = 1; i < newDates.length - 1; i++) {
                    additionUpdates.push({
                        tableName,
                        date: newDates[i],
                        startMinutes: 0,
                        endMinutes: 24 * 60,
                        quantity: bookingProduct.quantity,
                        maxQuantity: bookingProduct.products.total_quantity
                    });
                }
                additionUpdates.push({
                    tableName,
                    date: newEndDate,
                    startMinutes: 0,
                    endMinutes: newEndMinutes,
                    quantity: bookingProduct.quantity,
                    maxQuantity: bookingProduct.products.total_quantity
                });
            } else {
                additionUpdates.push({
                    tableName,
                    date: newDate,
                    startMinutes: newStartMinutes,
                    endMinutes: newEndMinutes,
                    quantity: bookingProduct.quantity,
                    maxQuantity: bookingProduct.products.total_quantity
                });
            }
        }

        // Repeat the same for addons (only if track_availability)
        for (const bookingAddon of booking.booking_addons) {
            if (!bookingAddon.addons.track_availability) continue;

            const tableName = `availability_addon_${bookingAddon.addons.id}`;
            
            // Subtract for old dates
            if (isOvernight) {
                // First day: from start time to midnight
                subtractionUpdates.push({
                    tableName,
                    date: oldDates[0],
                    startMinutes: oldStartMinutes,
                    endMinutes: 24 * 60,
                    quantity: bookingAddon.quantity,
                    maxQuantity: bookingAddon.addons.total_quantity
                });
                // Middle days: full days
                for (let i = 1; i < oldDates.length - 1; i++) {
                    subtractionUpdates.push({
                        tableName,
                        date: oldDates[i],
                        startMinutes: 0,
                        endMinutes: 24 * 60,
                        quantity: bookingAddon.quantity,
                        maxQuantity: bookingAddon.addons.total_quantity
                    });
                }
                // Last day: from midnight to end time
                subtractionUpdates.push({
                    tableName,
                    date: oldDates[oldDates.length - 1],
                    startMinutes: 0,
                    endMinutes: oldEndMinutes,
                    quantity: bookingAddon.quantity,
                    maxQuantity: bookingAddon.addons.total_quantity
                });
            } else {
                subtractionUpdates.push({
                    tableName,
                    date: booking.start_date,
                    startMinutes: oldStartMinutes,
                    endMinutes: oldEndMinutes,
                    quantity: bookingAddon.quantity,
                    maxQuantity: bookingAddon.addons.total_quantity
                });
            }
            // Add for new dates
            if (isOvernight) {
                const newDates = generateDateRange(newDate, newEndDate);
                additionUpdates.push({
                    tableName,
                    date: newDate,
                    startMinutes: newStartMinutes,
                    endMinutes: 24 * 60,
                    quantity: bookingAddon.quantity,
                    maxQuantity: bookingAddon.addons.total_quantity
                });
                for (let i = 1; i < newDates.length - 1; i++) {
                    additionUpdates.push({
                        tableName,
                        date: newDates[i],
                        startMinutes: 0,
                        endMinutes: 24 * 60,
                        quantity: bookingAddon.quantity,
                        maxQuantity: bookingAddon.addons.total_quantity
                    });
                }
                additionUpdates.push({
                    tableName,
                    date: newEndDate,
                    startMinutes: 0,
                    endMinutes: newEndMinutes,
                    quantity: bookingAddon.quantity,
                    maxQuantity: bookingAddon.addons.total_quantity
                });
            } else {
                additionUpdates.push({
                    tableName,
                    date: newDate,
                    startMinutes: newStartMinutes,
                    endMinutes: newEndMinutes,
                    quantity: bookingAddon.quantity,
                    maxQuantity: bookingAddon.addons.total_quantity
                });
            }
        }

        // Now update
        await updateAvailability(subtractionUpdates, true);
        await updateAvailability(additionUpdates, false);

        // Create history record before updating the booking
        const { error: historyError } = await supabaseServer
            .from('booking_history')
            .insert({
                booking_id: bookingId,
                action_type: 'reschedule',
                old_data: {
                    start_date: booking.start_date,
                    end_date: booking.end_date,
                    start_time: booking.start_time,
                    end_time: booking.end_time
                },
                new_data: {
                    start_date: newDate,
                    end_date: newEndDate,
                    start_time: newStartTime,
                    end_time: newEndTime
                },
                reason: reason || 'Customer requested reschedule'
            });

        if (historyError) {
            throw new Error('Failed to log booking history');
        }

        // Update the booking with new dates
        const { error: updateError } = await supabaseServer
            .from('bookings')
            .update({
                start_date: newDate,
                start_time: newStartTime,
                end_date: newEndDate,
                end_time: newEndTime
            })
            .eq('id', bookingId);

        if (updateError) {
            throw new Error('Failed to update booking');
        }

        // Send new confirmation email using Supabase Edge Function
        const emailEndpoint = `${PUBLIC_SUPABASE_URL}/functions/v1/send-booking-confirmation`;
        const emailResponse = await fetch(emailEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({ bookingId })
        });

        if (!emailResponse.ok) {
            throw new Error('Failed to send confirmation email');
        }

        return json({ success: true });
    } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Failed to reschedule booking' }, { status: 500 });
    }
}; 