// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Follow Deno and Supabase Edge Function conventions
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0"
import { format as formatDateFn } from 'https://deno.land/x/date_fns@v2.22.1/format/index.js'
import { sv } from 'https://deno.land/x/date_fns@v2.22.1/locale/index.js'
import { generateEmailHtml } from './emailHelpers.ts'
import { sendResendEmail } from './resendClient.ts'

// Price calculation functions
const VAT_RATE = 0.25; // 25% VAT in Sweden

function removeVat(priceIncludingVat: number): number {
    return priceIncludingVat / (1 + VAT_RATE);
}

function getBothPrices(priceExcludingVat: number, experienceType: string): {
    priceExcludingVat: number;
    priceIncludingVat: number;
} {
    // All prices in database are stored excluding VAT
    return {
        priceExcludingVat: priceExcludingVat,
        priceIncludingVat: addVat(priceExcludingVat)
    };
}

// These are automatically available in Edge Functions
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) throw new Error('Missing SUPABASE_URL');
if (!supabaseServiceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

// Create a Supabase client with the service role key
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

function formatDateTime(date: string, time: string): string {
  const dateTime = new Date(`${date}T${time}`);
  return dateTime.toLocaleString('sv-SE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDate(date: string): string {
  const dateObj = new Date(date);
  return dateObj.toLocaleString('sv-SE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(':');
  return `${hours}:${minutes}`;
}

function getDateTimeDisplay(booking: any): string {
  const isSameDay = booking.start_date === booking.end_date;
  
  if (isSameDay) {
    return `${formatDate(booking.start_date)} ${formatTime(booking.start_time)} till ${formatTime(booking.end_time)}`;
  } else {
    return `${formatDate(booking.start_date)} ${formatTime(booking.start_time)} till ${formatDate(booking.end_date)} ${formatTime(booking.end_time)}`;
  }
}

function getDurationText(type: string, value: number): string {
  if (type === 'hours') {
    return value === 1 ? '1 timme' : `${value} timmar`;
  } else if (type === 'overnights') {
    return value === 1 ? '1 övernattning' : `${value} övernattningar`;
  }
  return '';
}

function calculatePriceExcludingVat(totalIncludingVat: number): number {
    return totalIncludingVat / (1 + VAT_RATE);
}

function calculateVatAmountFromIncluded(totalIncludingVat: number): number {
    const priceExcludingVat = calculatePriceExcludingVat(totalIncludingVat);
    return totalIncludingVat - priceExcludingVat;
}

function calculateVatAmountFromExcluded(priceExcludingVat: number): number {
    return priceExcludingVat * VAT_RATE;
}

function formatPrice(amount: number): string {
    // Deno doesn't have Intl built-in in the same way, format manually for SEK
    // Ensure rounding to nearest whole number for SEK
    const roundedAmount = Math.round(amount);
    return `${roundedAmount.toLocaleString('sv-SE')} kr`;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Allow': 'POST' },
    });
  }

  try {
    const body = await req.json();
    const { bookingId } = body;

    if (!bookingId) {
      return new Response(JSON.stringify({ error: 'Booking ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fetch booking details with all related data
    // Ensure total_price is selected via *
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select(`
        *,\
        experience:experiences!bookings_experience_id_fkey (\
          name\
        ),\
        start_location:start_locations (\
          name\
        ),\
        duration:durations (\
          duration_type,\
          duration_value,\
          extra_price\
        ),\
        booking_price_groups (\
          quantity,\
          price_at_time,\
          price_groups (\
            display_name\
          )\
        ),\
        booking_products (\
          quantity,\
          price_at_time,\
          products (\
            name\
          )\
        ),\
        booking_addons (\
          quantity,\
          price_at_time,\
          addons (\
            name\
          )\
        )\
      `)
      .eq('id', bookingId)
      .single();

    if (bookingError) {
      return new Response(JSON.stringify({ error: 'Error fetching booking', details: bookingError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!booking) {
      return new Response(JSON.stringify({ error: 'Booking not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (booking.total_price === null || booking.total_price === undefined) {
      return new Response(JSON.stringify({ error: 'Booking price information is incomplete' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Generate email HTML using the new function
    const emailHtml = generateEmailHtml(booking);

    // Send email using Resend
    const { response: resendResponse, data: resendData } = await sendResendEmail({
      to: booking.email,
      subject: `Bokningsbekräftelse - ${booking.booking_number} - Stisses`,   
      html: emailHtml,
    });

    if (!resendResponse.ok) {
      return new Response(JSON.stringify({ warning: 'Booking confirmed, but failed to send email', details: resendData }), {
        status: 502, // Bad Gateway or similar, indicating an upstream failure
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, message: "Email sent successfully", resend_id: resendData?.id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

/* Example Invocation (for testing)

curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/send-booking-confirmation' \
  --header "Authorization: Bearer YOUR_SUPABASE_ANON_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"bookingId": YOUR_BOOKING_ID}' # Replace with a real booking ID

*/
