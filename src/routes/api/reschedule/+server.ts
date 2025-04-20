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
async function loadAvailabilityIntoCache(tableName: string, dates: string[]): Promise<void> {
    const loadPromises = dates.map(async date => {
        const cacheKey = getCacheKey(tableName, date);
        if (!availabilityCache.has(cacheKey)) {
            const { data } = await supabaseServer
                .from(tableName)
                .select('*')
                .eq('datum', date)
                .single();

            if (data) {
                const slotMap = new Map<string, number>();
                Object.entries(data).forEach(([key, value]) => {
                    if (key !== 'datum') {
                        slotMap.set(key, value as number);
                    }
                });
                availabilityCache.set(cacheKey, slotMap);
            } else {
                availabilityCache.set(cacheKey, new Map<string, number>());
            }
        }
    });

    await Promise.all(loadPromises);
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
        slotMap.set(minute, value);
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
    
    for (const update of updates) {
        const { tableName, date, startMinutes, endMinutes, quantity, maxQuantity } = update;
        
        if (!groupedUpdates.has(tableName)) {
            groupedUpdates.set(tableName, new Map());
        }
        
        const dateMap = groupedUpdates.get(tableName)!;
        if (!dateMap.has(date)) {
            dateMap.set(date, {});
        }
        
        const dateUpdates = dateMap.get(date)!;
        
        // Load availability data into cache
        await loadAvailabilityIntoCache(tableName, [date]);
        
        // Generate updates for all time slots
        for (let minute = startMinutes; minute <= endMinutes; minute += 15) {
            const slotKey = minute.toString();
            const currentValue = getAvailabilityFromCache(tableName, date, slotKey);
            const newValue = isSubtract 
                ? Math.max(0, currentValue - quantity)
                : currentValue + quantity;

            if (newValue > maxQuantity) {
                throw new Error(`Exceeds maximum quantity (${maxQuantity}) for ${tableName} on ${date}`);
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
        const { bookingId, newDate, newStartTime, newEndTime } = await request.json();

        // Get booking data from cache or database
        const booking = await getBookingData(bookingId);

        // Convert times to minutes
        const oldStartMinutes = parseInt(booking.start_time.split(':')[0]) * 60 + parseInt(booking.start_time.split(':')[1]);
        const oldEndMinutes = parseInt(booking.end_time.split(':')[0]) * 60 + parseInt(booking.end_time.split(':')[1]);
        const newStartMinutes = parseInt(newStartTime.split(':')[0]) * 60 + parseInt(newStartTime.split(':')[1]);
        const newEndMinutes = parseInt(newEndTime.split(':')[0]) * 60 + parseInt(newEndTime.split(':')[1]);

        // Check if it's an overnight booking
        const isOvernight = booking.duration.duration_type === 'overnights';
        const oldDates = generateDateRange(booking.start_date, booking.end_date);
        const newEndDate = isOvernight 
            ? format(addDays(parseISO(newDate), booking.duration.duration_value), 'yyyy-MM-dd')
            : newDate;

        // Prepare availability updates for both old and new dates
        const availabilityUpdates: AvailabilityUpdate[] = [];

        // Add product updates
        for (const bookingProduct of booking.booking_products) {
            const tableName = `availability_product_${bookingProduct.products.id}`;
            
            // Add updates for old dates (subtract)
            if (isOvernight) {
                // First day: from start time to midnight
                availabilityUpdates.push({
                    tableName,
                    date: oldDates[0],
                    startMinutes: oldStartMinutes,
                    endMinutes: 24 * 60,
                    quantity: bookingProduct.quantity,
                    maxQuantity: bookingProduct.products.total_quantity
                });

                // Middle days: full days
                for (let i = 1; i < oldDates.length - 1; i++) {
                    availabilityUpdates.push({
                        tableName,
                        date: oldDates[i],
                        startMinutes: 0,
                        endMinutes: 24 * 60,
                        quantity: bookingProduct.quantity,
                        maxQuantity: bookingProduct.products.total_quantity
                    });
                }

                // Last day: from midnight to end time
                availabilityUpdates.push({
                    tableName,
                    date: oldDates[oldDates.length - 1],
                    startMinutes: 0,
                    endMinutes: oldEndMinutes,
                    quantity: bookingProduct.quantity,
                    maxQuantity: bookingProduct.products.total_quantity
                });
            } else {
                // Single day booking
                availabilityUpdates.push({
                    tableName,
                    date: booking.start_date,
                    startMinutes: oldStartMinutes,
                    endMinutes: oldEndMinutes,
                    quantity: bookingProduct.quantity,
                    maxQuantity: bookingProduct.products.total_quantity
                });
            }

            // Add updates for new dates (add)
            if (isOvernight) {
                // First day: from start time to midnight
                availabilityUpdates.push({
                    tableName,
                    date: newDate,
                    startMinutes: newStartMinutes,
                    endMinutes: 24 * 60,
                    quantity: bookingProduct.quantity,
                    maxQuantity: bookingProduct.products.total_quantity
                });

                // Middle days: full days
                const newDates = generateDateRange(newDate, newEndDate);
                for (let i = 1; i < newDates.length - 1; i++) {
                    availabilityUpdates.push({
                        tableName,
                        date: newDates[i],
                        startMinutes: 0,
                        endMinutes: 24 * 60,
                        quantity: bookingProduct.quantity,
                        maxQuantity: bookingProduct.products.total_quantity
                    });
                }

                // Last day: from midnight to end time
                availabilityUpdates.push({
                    tableName,
                    date: newEndDate,
                    startMinutes: 0,
                    endMinutes: newEndMinutes,
                    quantity: bookingProduct.quantity,
                    maxQuantity: bookingProduct.products.total_quantity
                });
            } else {
                // Single day booking
                availabilityUpdates.push({
                    tableName,
                    date: newDate,
                    startMinutes: newStartMinutes,
                    endMinutes: newEndMinutes,
                    quantity: bookingProduct.quantity,
                    maxQuantity: bookingProduct.products.total_quantity
                });
            }
        }

        // Add addon updates
        for (const bookingAddon of booking.booking_addons) {
            if (!bookingAddon.addons.track_availability) continue;

            const tableName = `availability_addon_${bookingAddon.addons.id}`;
            
            // Add updates for old dates (subtract)
            if (isOvernight) {
                // First day: from start time to midnight
                availabilityUpdates.push({
                    tableName,
                    date: oldDates[0],
                    startMinutes: oldStartMinutes,
                    endMinutes: 24 * 60,
                    quantity: bookingAddon.quantity,
                    maxQuantity: bookingAddon.addons.total_quantity
                });

                // Middle days: full days
                for (let i = 1; i < oldDates.length - 1; i++) {
                    availabilityUpdates.push({
                        tableName,
                        date: oldDates[i],
                        startMinutes: 0,
                        endMinutes: 24 * 60,
                        quantity: bookingAddon.quantity,
                        maxQuantity: bookingAddon.addons.total_quantity
                    });
                }

                // Last day: from midnight to end time
                availabilityUpdates.push({
                    tableName,
                    date: oldDates[oldDates.length - 1],
                    startMinutes: 0,
                    endMinutes: oldEndMinutes,
                    quantity: bookingAddon.quantity,
                    maxQuantity: bookingAddon.addons.total_quantity
                });
            } else {
                // Single day booking
                availabilityUpdates.push({
                    tableName,
                    date: booking.start_date,
                    startMinutes: oldStartMinutes,
                    endMinutes: oldEndMinutes,
                    quantity: bookingAddon.quantity,
                    maxQuantity: bookingAddon.addons.total_quantity
                });
            }

            // Add updates for new dates (add)
            if (isOvernight) {
                // First day: from start time to midnight
                availabilityUpdates.push({
                    tableName,
                    date: newDate,
                    startMinutes: newStartMinutes,
                    endMinutes: 24 * 60,
                    quantity: bookingAddon.quantity,
                    maxQuantity: bookingAddon.addons.total_quantity
                });

                // Middle days: full days
                const newDates = generateDateRange(newDate, newEndDate);
                for (let i = 1; i < newDates.length - 1; i++) {
                    availabilityUpdates.push({
                        tableName,
                        date: newDates[i],
                        startMinutes: 0,
                        endMinutes: 24 * 60,
                        quantity: bookingAddon.quantity,
                        maxQuantity: bookingAddon.addons.total_quantity
                    });
                }

                // Last day: from midnight to end time
                availabilityUpdates.push({
                    tableName,
                    date: newEndDate,
                    startMinutes: 0,
                    endMinutes: newEndMinutes,
                    quantity: bookingAddon.quantity,
                    maxQuantity: bookingAddon.addons.total_quantity
                });
            } else {
                // Single day booking
                availabilityUpdates.push({
                    tableName,
                    date: newDate,
                    startMinutes: newStartMinutes,
                    endMinutes: newEndMinutes,
                    quantity: bookingAddon.quantity,
                    maxQuantity: bookingAddon.addons.total_quantity
                });
            }
        }

        // First subtract from old dates
        await updateAvailability(
            availabilityUpdates.filter(u => oldDates.includes(u.date)),
            true // subtract
        );

        // Then add to new dates
        await updateAvailability(
            availabilityUpdates.filter(u => u.date >= newDate && u.date <= newEndDate),
            false // add
        );

        // Update the booking with new dates
        const { error: updateError } = await supabase
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
            console.error('Failed to send confirmation email:', await emailResponse.text());
        } else {
            console.log('Successfully sent confirmation email');
        }

        return json({ success: true });
    } catch (error) {
        console.error('Error in reschedule endpoint:', error);
        return json({ error: error instanceof Error ? error.message : 'Failed to reschedule booking' }, { status: 500 });
    }
}; 