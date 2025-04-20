import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import type { BookingProduct, BookingAddon } from './[bookingId]/+server';

interface AvailabilityUpdate {
    tableName: string;
    date: string;
    startMinutes: number;
    endMinutes: number;
    quantity: number;
    maxQuantity: number;
}

async function updateAvailability(updates: AvailabilityUpdate[], isSubtract: boolean = false) {
    for (const update of updates) {
        const { tableName, date, startMinutes, endMinutes, quantity } = update;
        
        console.log(`${isSubtract ? 'Subtracting from' : 'Adding to'} availability table: ${tableName}`);
        console.log(`Date: ${date}, Time: ${startMinutes}-${endMinutes}, Quantity: ${quantity}`);

        // Ensure the date exists in the availability table
        const { data: existingDate } = await supabase
            .from(tableName)
            .select('datum')
            .eq('datum', date)
            .single();

        if (!existingDate) {
            console.log(`Creating new date entry for ${date} in ${tableName}`);
            await supabase
                .from(tableName)
                .insert({ datum: date });
        }

        // Generate update object for all time slots
        const updates: Record<string, number> = {};
        for (let minute = startMinutes; minute <= endMinutes; minute += 15) {
            const slotKey = minute.toString();
            // Get current value for the slot
            const { data: currentSlot } = await supabase
                .from(tableName)
                .select(slotKey)
                .eq('datum', date)
                .single();

            const currentValue = ((currentSlot as unknown) as Record<string, number | null>)?.[slotKey] || 0;
            const newValue = isSubtract 
                ? Math.max(0, currentValue - quantity)  // Subtract but don't go below 0
                : currentValue + quantity;

            console.log(`${tableName} - Slot ${minute} (${slotKey}): ${currentValue} -> ${newValue}`);

            if (newValue > update.maxQuantity) {
                throw new Error(`Exceeds maximum quantity (${update.maxQuantity}) for ${tableName} on ${date}`);
            }

            updates[slotKey] = newValue;
        }

        // Update all slots at once
        const { error: updateError } = await supabase
            .from(tableName)
            .update(updates)
            .eq('datum', date);

        if (updateError) {
            console.error(`Error updating ${tableName}:`, updateError);
            throw updateError;
        }

        console.log(`Successfully updated ${tableName} for ${date}`);
    }
}

export const POST: RequestHandler = async ({ request }) => {
    try {
        const { bookingId, newDate, newStartTime, newEndTime } = await request.json();

        console.log('Processing rebooking request:', { bookingId, newDate, newStartTime, newEndTime });

        // Fetch the original booking details
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
            return json({ error: 'Booking not found' }, { status: 404 });
        }

        // Convert times to minutes
        const oldStartMinutes = parseInt(booking.start_time.split(':')[0]) * 60 + parseInt(booking.start_time.split(':')[1]);
        const oldEndMinutes = parseInt(booking.end_time.split(':')[0]) * 60 + parseInt(booking.end_time.split(':')[1]);
        const newStartMinutes = parseInt(newStartTime.split(':')[0]) * 60 + parseInt(newStartTime.split(':')[1]);
        const newEndMinutes = parseInt(newEndTime.split(':')[0]) * 60 + parseInt(newEndTime.split(':')[1]);

        // Prepare availability updates for both old and new dates
        const availabilityUpdates: AvailabilityUpdate[] = [];

        // Add product updates
        for (const bookingProduct of booking.booking_products) {
            const tableName = `availability_product_${bookingProduct.products.id}`;
            
            // Add update for old date (subtract)
            availabilityUpdates.push({
                tableName,
                date: booking.start_date,
                startMinutes: oldStartMinutes,
                endMinutes: oldEndMinutes,
                quantity: bookingProduct.quantity,
                maxQuantity: bookingProduct.products.total_quantity
            });

            // Add update for new date (add)
            availabilityUpdates.push({
                tableName,
                date: newDate,
                startMinutes: newStartMinutes,
                endMinutes: newEndMinutes,
                quantity: bookingProduct.quantity,
                maxQuantity: bookingProduct.products.total_quantity
            });
        }

        // Add addon updates
        for (const bookingAddon of booking.booking_addons) {
            if (!bookingAddon.addons.track_availability) continue;

            const tableName = `availability_addon_${bookingAddon.addons.id}`;
            
            // Add update for old date (subtract)
            availabilityUpdates.push({
                tableName,
                date: booking.start_date,
                startMinutes: oldStartMinutes,
                endMinutes: oldEndMinutes,
                quantity: bookingAddon.quantity,
                maxQuantity: bookingAddon.addons.total_quantity
            });

            // Add update for new date (add)
            availabilityUpdates.push({
                tableName,
                date: newDate,
                startMinutes: newStartMinutes,
                endMinutes: newEndMinutes,
                quantity: bookingAddon.quantity,
                maxQuantity: bookingAddon.addons.total_quantity
            });
        }

        console.log('Preparing availability updates:');
        console.log('Products:', booking.booking_products.map((p: BookingProduct) => ({
            id: p.products.id,
            quantity: p.quantity,
            maxQuantity: p.products.total_quantity
        })));
        console.log('Addons:', booking.booking_addons.map((a: BookingAddon) => ({
            id: a.addons.id,
            quantity: a.quantity,
            maxQuantity: a.addons.total_quantity,
            trackAvailability: a.addons.track_availability
        })));

        // First subtract from old dates
        await updateAvailability(
            availabilityUpdates.filter(u => u.date === booking.start_date),
            true // subtract
        );

        // Then add to new dates
        await updateAvailability(
            availabilityUpdates.filter(u => u.date === newDate),
            false // add
        );

        // Update the booking with new dates
        const { error: updateError } = await supabase
            .from('bookings')
            .update({
                start_date: newDate,
                start_time: newStartTime,
                end_date: booking.duration.duration_type === 'hours' ? newDate : null, // Will be calculated for overnight bookings
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