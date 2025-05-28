import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { addDays, format, parseISO } from 'date-fns';

// Create a Supabase client with the service role key
const supabase = createClient(
  PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false
    }
  }
);

// Helper function to convert time (HH:MM) to minutes since midnight
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// Helper function to generate dates between start and end date
export function generateDateRange(startDate: string, endDate: string): string[] {
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

// Helper function to calculate end date for overnight bookings
export function calculateEndDate(startDate: string, durationValue: number): string {
  const start = parseISO(startDate);
  const end = addDays(start, durationValue);
  return format(end, 'yyyy-MM-dd');
}

// Helper function to check if date exists and create if it doesn't
export async function ensureDateExists(tableName: string, date: string) {
  // Use upsert with ON CONFLICT DO NOTHING to handle race conditions
  const { error: insertError } = await supabase
    .from(tableName)
    .upsert({ datum: date }, { onConflict: 'datum', ignoreDuplicates: true });

  if (insertError) {
    throw insertError;
  }
}

// Helper function to check if quantity exceeds max limit
export async function checkQuantityLimit(
  tableName: string,
  date: string,
  startMinutes: number,
  endMinutes: number,
  requestedQuantity: number,
  maxQuantity: number
): Promise<boolean> {
  const { data: currentAvailability } = await supabase
    .from(tableName)
    .select('*')
    .eq('datum', date)
    .single();

  if (!currentAvailability) {
    return requestedQuantity <= maxQuantity;
  }

  // Check each 15-minute slot
  for (let minute = startMinutes; minute < endMinutes; minute += 15) {
    const slotKey = minute.toString();
    const currentlyBooked = currentAvailability[slotKey] || 0;
    const wouldBeBooked = currentlyBooked + requestedQuantity;

    if (wouldBeBooked > maxQuantity) {
      return false;
    }
  }

  return true;
}

// Helper function to update availability for a specific table
export async function updateAvailability(
  tableName: string,
  date: string,
  startMinutes: number,
  endMinutes: number,
  quantity: number,
  maxQuantity: number,
  operation: 'add' | 'subtract' = 'add'
) {
  try {
    // Ensure the date exists first
    await ensureDateExists(tableName, date);

    // For add operations, check quantity limits
    if (operation === 'add') {
      const isWithinLimits = await checkQuantityLimit(
        tableName,
        date,
        startMinutes,
        endMinutes,
        quantity,
        maxQuantity
      );

      if (!isWithinLimits) {
        throw new Error(`Booking would exceed maximum quantity for ${tableName} on ${date}`);
      }
    }

    // Get current availability data
    const { data: currentData } = await supabase
      .from(tableName)
      .select('*')
      .eq('datum', date)
      .single();

    // Generate the update object for all 15-minute slots
    const updates: Record<string, number> = {};
    for (let minute = startMinutes; minute < endMinutes; minute += 15) {
      const slotKey = minute.toString();
      const currentValue = currentData?.[slotKey] || 0;
      
      if (operation === 'add') {
        updates[slotKey] = currentValue + quantity;
      } else {
        updates[slotKey] = Math.max(0, currentValue - quantity); // Prevent negative values
      }
    }

    // Update the availability
    const { error: updateError } = await supabase
      .from(tableName)
      .update(updates)
      .eq('datum', date);

    if (updateError) {
      throw updateError;
    }
  } catch (error) {
    throw error;
  }
}

// Main function to handle availability updates for a booking
export async function updateAvailabilityForBooking(
  bookingData: {
    start_date: string;
    end_date: string;
    start_time: string;
    end_time: string;
    duration_id: string;
  },
  products: Array<{ id: number; quantity: number }>,
  addons: Array<{ id: number; quantity: number }>,
  operation: 'add' | 'subtract' = 'add'
) {
  const startDate = bookingData.start_date;
  const startTime = bookingData.start_time;
  const endTime = bookingData.end_time;
  
  // Get duration details to properly determine if it's overnight
  const { data: durationData } = await supabase
    .from('durations')
    .select('duration_type, duration_value')
    .eq('id', bookingData.duration_id)
    .single();

  // Check if it's an overnight booking based on duration type
  const isOvernight = durationData?.duration_type === 'overnights';
  const endDate = isOvernight 
    ? calculateEndDate(startDate, durationData?.duration_value || 0)
    : bookingData.end_date;

  const dates = generateDateRange(startDate, endDate);
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  // Handle products first (all products have availability tracking)
  for (const product of products) {
    try {
      // Get product's max quantity
      const { data: productData, error: productError } = await supabase
        .from('products')
        .select('total_quantity')
        .eq('id', product.id)
        .single();

      if (productError) {
        throw productError;
      }

      if (!productData) {
        throw new Error(`Product ${product.id} not found`);
      }

      const tableName = `availability_product_${product.id}`;

      if (isOvernight) {
        await updateAvailability(
          tableName,
          dates[0],
          startMinutes,
          24 * 60,
          product.quantity,
          productData.total_quantity,
          operation
        );

        if (dates.length > 2) {
          for (let i = 1; i < dates.length - 1; i++) {
            await updateAvailability(
              tableName,
              dates[i],
              0,
              24 * 60,
              product.quantity,
              productData.total_quantity,
              operation
            );
          }
        }

        await updateAvailability(
          tableName,
          dates[dates.length - 1],
          0,
          endMinutes,
          product.quantity,
          productData.total_quantity,
          operation
        );
      } else {
        await updateAvailability(
          tableName,
          startDate,
          startMinutes,
          endMinutes,
          product.quantity,
          productData.total_quantity,
          operation
        );
      }
    } catch (error) {
      throw error;
    }
  }

  // Handle addons (need to check track_availability)
  for (const addon of addons) {
    try {
      // Check if addon tracks availability and get max quantity
      const { data: addonData } = await supabase
        .from('addons')
        .select('track_availability, total_quantity')
        .eq('id', addon.id)
        .single();

      if (!addonData) {
        throw new Error(`Addon ${addon.id} not found`);
      }

      if (addonData.track_availability) {
        const tableName = `availability_addon_${addon.id}`;

        if (isOvernight) {
          await updateAvailability(
            tableName,
            dates[0],
            startMinutes,
            24 * 60,
            addon.quantity,
            addonData.total_quantity,
            operation
          );

          if (dates.length > 2) {
            for (let i = 1; i < dates.length - 1; i++) {
              await updateAvailability(
                tableName,
                dates[i],
                0,
                24 * 60,
                addon.quantity,
                addonData.total_quantity,
                operation
              );
            }
          }

          await updateAvailability(
            tableName,
            dates[dates.length - 1],
            0,
            endMinutes,
            addon.quantity,
            addonData.total_quantity,
            operation
          );
        } else {
          await updateAvailability(
            tableName,
            startDate,
            startMinutes,
            endMinutes,
            addon.quantity,
            addonData.total_quantity,
            operation
          );
        }
      }
    } catch (error) {
      throw error;
    }
  }
} 