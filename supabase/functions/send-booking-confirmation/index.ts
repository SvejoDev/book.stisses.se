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

console.log('Edge Function initializing...');

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
console.log('RESEND_API_KEY present:', !!RESEND_API_KEY);

// These are automatically available in Edge Functions
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');


if (!RESEND_API_KEY) throw new Error('Missing RESEND_API_KEY');
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

function generateEmailHtml(booking: any): string {
    const totalPriceIncludingVat = booking.total_price || 0;
    const totalPriceExcludingVat = calculatePriceExcludingVat(totalPriceIncludingVat);
    const totalVatAmount = calculateVatAmountFromIncluded(totalPriceIncludingVat);

    // Helper to safely access nested properties
    const get = (obj: any, path: string, defaultValue: any = null) => {
        const keys = path.split('.');
        let result = obj;
        for (const key of keys) {
            result = result?.[key];
            if (result === undefined || result === null) {
                return defaultValue;
            }
        }
        return result;
    };

    const bookingPriceGroupsHtml = (booking.booking_price_groups || []).map((group: any) => {
        const priceExclVat = get(group, 'price_at_time', 0);
        const itemVat = calculateVatAmountFromExcluded(priceExclVat);
        return `
        <tr>
            <td>${get(group, 'price_groups.display_name', 'Okänd grupp')}</td>
            <td style="text-align: center;">${get(group, 'quantity', 0)}</td>
            <td style="text-align: right;">${formatPrice(priceExclVat)}</td>
            <td style="text-align: right;">${formatPrice(itemVat)}</td>
        </tr>
    `;
    }).join('');

    const bookingProductsHtml = (booking.booking_products || []).map((product: any) => {
        const priceExclVat = get(product, 'price_at_time', 0);
        const itemVat = calculateVatAmountFromExcluded(priceExclVat);
        return `
        <tr>
            <td>${get(product, 'products.name', 'Okänd produkt')}</td>
            <td style="text-align: center;">${get(product, 'quantity', 0)}</td>
            <td style="text-align: right;">${formatPrice(priceExclVat)}</td>
            <td style="text-align: right;">${formatPrice(itemVat)}</td>
        </tr>
    `;
    }).join('');

    const bookingAddonsHtml = (booking.booking_addons || []).map((addon: any) => {
        const priceExclVat = get(addon, 'price_at_time', 0);
        const itemVat = calculateVatAmountFromExcluded(priceExclVat);
        return `
        <tr>
            <td>${get(addon, 'addons.name', 'Okänt tillägg')}</td>
            <td style="text-align: center;">${get(addon, 'quantity', 0)}</td>
            <td style="text-align: right;">${formatPrice(priceExclVat)}</td>
            <td style="text-align: right;">${formatPrice(itemVat)}</td>
        </tr>
    `;
    }).join('');

    // Calculate Duration Cost
    const payingCustomersCount = (booking.booking_price_groups || []).reduce((sum: number, group: any) => sum + get(group, 'quantity', 0), 0);
    const durationExtraPrice = get(booking, 'duration.extra_price', 0);
    const durationCostExclVat = durationExtraPrice * payingCustomersCount;
    const durationItemVat = calculateVatAmountFromExcluded(durationCostExclVat);

    let durationHtml = '';
    if (durationCostExclVat > 0) {
        durationHtml = `
        <tr>
            <td>Avgift för tidslängd (${getDurationText(get(booking, 'duration.duration_type'), get(booking, 'duration.duration_value'))})</td>
            <td style="text-align: center;">(${payingCustomersCount} pers × ${formatPrice(durationExtraPrice)})</td>
            <td style="text-align: right;">${formatPrice(durationCostExclVat)}</td>
            <td style="text-align: right;">${formatPrice(durationItemVat)}</td>
        </tr>
        `;
    }

    const siteUrl = Deno.env.get('PUBLIC_SITE_URL') || 'http://localhost:5173'; // Fallback for local dev

    const bookingGuaranteeHtml = booking.has_booking_guarantee ? `
        <div class="section">
            <h2>Ombokningsgaranti</h2>
            <p>Du har köpt ombokningsgaranti för denna bokning. Om du behöver omboka din tid, klicka på länken nedan:</p>
            <p style="text-align: center; margin-top: 16px;">
                <a href="${siteUrl}/booking/reschedule/${booking.id}" 
                   style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                    Omboka din tid
                </a>
            </p>
            <p style="font-size: 12px; color: #6b7280; margin-top: 8px;">
                Länken är giltig fram till 24 timmar innan din bokade tid.
            </p>
        </div>
    ` : '';

    const commentHtml = booking.comment ? `
        <div class="section comment-section">
            <h3>Meddelande från dig</h3>
            <p>${booking.comment.replace(/\\n/g, '<br>')}</p>
        </div>
    ` : '';

    return `
      <!DOCTYPE html>
      <html lang="sv">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Bokningsbekräftelse - ${booking.booking_number}</title>
          <style>
            body {
              margin: 0;
              padding: 0;
              background-color: #f3f4f6; /* Light gray background */
              font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
              line-height: 1.6;
              color: #374151; /* Gray 700 */
            }
            .wrapper {
              max-width: 600px;
              margin: 20px auto;
              background-color: #ffffff;
              border: 1px solid #e5e7eb; /* Gray 200 */
              border-radius: 8px;
              overflow: hidden;
            }
            .content {
              padding: 24px 32px;
            }
            .header {
              text-align: center;
              padding: 24px 32px;
              border-bottom: 1px solid #e5e7eb; /* Gray 200 */
            }
            .header img {
              max-width: 160px;
              margin-bottom: 16px;
            }
            .header h1 {
              font-size: 24px;
              font-weight: 600;
              color: #111827; /* Gray 900 */
              margin: 0 0 8px 0;
            }
            .header p {
              font-size: 16px;
              color: #6b7280; /* Gray 500 */
              margin: 4px 0 0 0;
            }
            .section {
              margin-bottom: 24px;
              padding-bottom: 24px;
              border-bottom: 1px solid #e5e7eb; /* Gray 200 */
            }
            .section:last-child {
              margin-bottom: 0;
              padding-bottom: 0;
              border-bottom: none;
            }
            .section h2 {
              font-size: 18px;
              font-weight: 600;
              color: #1f2937; /* Gray 800 */
              margin: 0 0 12px 0;
            }
            .section h3 {
              font-size: 14px;
              font-weight: 500;
              color: #6b7280; /* Gray 500 */
              margin: 0 0 4px 0;
            }
            .section p {
              font-size: 16px;
              color: #1f2937; /* Gray 800 */
              margin: 0 0 8px 0;
            }
            .grid-2 {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 16px;
              margin-bottom: 16px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              font-size: 14px;
            }
            th, td {
              padding: 8px 4px;
              text-align: left;
              border-bottom: 1px solid #f3f4f6; /* Gray 100 */
              color: #374151; /* Gray 700 */
            }
            th {
              font-weight: 500;
              color: #6b7280; /* Gray 500 */
              background-color: #f9fafb; /* Gray 50 */
            }
            td:last-child {
              text-align: right;
            }
            .totals-section {
              background-color: #f9fafb; /* Gray 50 */
              padding: 16px;
              border-radius: 6px;
              margin-top: 16px;
            }
            .totals-section table {
              font-size: 16px;
            }
            .totals-section td {
              border: none;
              padding: 4px 0;
            }
            .totals-section .total-row td {
               padding-top: 8px;
               border-top: 1px solid #e5e7eb; /* Gray 200 */
               font-weight: 600;
               color: #111827; /* Gray 900 */
            }
            .totals-section .paid-row td {
               font-weight: 600;
               color: #059669; /* Green 600 */
            }
            .comment-section p {
                white-space: pre-wrap;
                font-size: 14px;
                color: #4b5563; /* Gray 600 */
                background-color: #f9fafb; /* Gray 50 */
                padding: 12px;
                border-radius: 4px;
            }
            .footer {
              text-align: center;
              padding: 24px 32px;
              border-top: 1px solid #e5e7eb; /* Gray 200 */
              background-color: #f9fafb; /* Gray 50 */
              font-size: 12px;
              color: #6b7280; /* Gray 500 */
            }
            .footer p {
              margin: 4px 0;
            }
            .footer a {
              color: #4f46e5; /* Indigo 600 */
              text-decoration: none;
            }
            .footer a:hover {
              text-decoration: underline;
            }

            @media only screen and (max-width: 600px) {
              .content { padding: 16px 20px; }
              .header { padding: 16px 20px; }
              .footer { padding: 16px 20px; }
              .header h1 { font-size: 20px; }
              .header p { font-size: 14px; }
              .section h2 { font-size: 16px; }
              .section p, .section h3, table { font-size: 14px; }
              .grid-2 { grid-template-columns: 1fr; }
              .totals-section table { font-size: 14px; }
            }
          </style>
        </head>
        <body>
          <div class="wrapper">
            <div class="header">
              <img src="https://stisses.se/images/logo.png" alt="Stisses Logotyp" />
              <h1>Bokningsbekräftelse</h1>
              <p>Tack för din bokning, ${booking.first_name}!</p>
              <p style="font-size: 14px;">Bokningsnummer: <strong>${booking.booking_number}</strong></p>
            </div>

            <div class="content">
              <div class="section">
                <h2>Aktivitet</h2>
                <div class="grid-2">
                    <div>
                        <h3>Namn</h3>
                        <p>${get(booking, 'experience.name', 'Okänd aktivitet')}</p>
                    </div>
                    <div>
                        <h3>Startplats</h3>
                        <p>${get(booking, 'start_location.name', 'Okänd startplats')}</p>
                    </div>
                </div>
                 <div>
                    <h3>Längd</h3>
                    <p>${getDurationText(get(booking, 'duration.duration_type'), get(booking, 'duration.duration_value'))}</p>
                </div>
              </div>

              <div class="section">
                <h2>Datum & Tid</h2>
                <p><strong>Start:</strong> ${formatDateTime(booking.start_date, booking.start_time)}</p>
                <p><strong>Slut:</strong> ${formatDateTime(booking.end_date, booking.end_time)}</p>
              </div>

              <div class="section">
                <h2>Kontaktuppgifter</h2>
                <p>${booking.first_name} ${booking.last_name}</p>
                <p>${booking.email}</p>
                <p>${booking.phone}</p>
              </div>

              <div class="section">
                <h2>Bokningsdetaljer</h2>
                <table>
                  <thead>
                    <tr>
                      <th>Produkt</th>
                      <th style="text-align: center;">Antal</th>
                      <th style="text-align: right;">Pris (exkl. moms)</th>
                      <th style="text-align: right;">Moms</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${bookingPriceGroupsHtml}
                    ${bookingProductsHtml}
                    ${bookingAddonsHtml}
                    ${durationHtml}
                  </tbody>
                </table>

                <div class="totals-section">
                  <table>
                    <tr>
                      <td>Totalt (exkl. moms)</td>
                      <td>${formatPrice(totalPriceExcludingVat)}</td>
                    </tr>
                    <tr>
                      <td>Moms (${VAT_RATE * 100}%)</td>
                      <td>${formatPrice(totalVatAmount)}</td>
                    </tr>
                    <tr class="total-row">
                      <td>Totalt pris (inkl. moms)</td>
                      <td>${formatPrice(totalPriceIncludingVat)}</td>
                    </tr>
                    <tr class="paid-row">
                      <td>Betalat</td>
                      <td>${formatPrice(totalPriceIncludingVat)}</td>
                    </tr>
                  </table>
                </div>
              </div>

              ${bookingGuaranteeHtml}

              ${commentHtml}

            </div>

            <div class="footer">
              <p><strong>Stisses Sport och Fritid AB</strong></p>
              <p>Organisationsnummer: 559416-1308</p>
              <p>Momsregisternummer: SE559416130801</p>
              <p>Reningsverksvägen 2, 26232 Ängelholm</p>
              <p>Vid frågor, kontakta oss på <a href="mailto:info@stisses.se">info@stisses.se</a> eller ring <a href="tel:+46703259638">+46703259638</a>.</p>
              <p style="margin-top: 16px;">© ${new Date().getFullYear()} Stisses Sport och Fritid AB. Alla rättigheter förbehållna.</p>
            </div>
          </div>
        </body>
      </html>
    `;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Allow': 'POST' },
    });
  }

  try {
    console.log('Received request to send booking confirmation');
    const body = await req.json();
    const { bookingId } = body;

    if (!bookingId) {
      console.error('No booking ID provided');
      return new Response(JSON.stringify({ error: 'Booking ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log('Fetching booking details for ID:', bookingId);

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
      console.error('Error fetching booking:', bookingError);
      return new Response(JSON.stringify({ error: 'Error fetching booking', details: bookingError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!booking) {
      console.error('Booking not found for ID:', bookingId);
      return new Response(JSON.stringify({ error: 'Booking not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (booking.total_price === null || booking.total_price === undefined) {
      console.error('Booking total_price is missing for ID:', bookingId);
      // Potentially fallback or handle differently if needed
      return new Response(JSON.stringify({ error: 'Booking price information is incomplete' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log('Found booking:', {
      id: booking.id,
      number: booking.booking_number,
      email: booking.email,
      total_price: booking.total_price
    });

    // Generate email HTML using the new function
    const emailHtml = generateEmailHtml(booking);

    // Send email using Resend
    console.log('Preparing to send email to:', booking.email);
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Stisses Bokning <noreply@svejo.se>', // Consider a more specific sender name
        to: booking.email,
        subject: `Bokningsbekräftelse - ${booking.booking_number} - Stisses`, // Add company name for clarity
        html: emailHtml,
      }),
    });

    const resendData = await resendResponse.json();
    console.log('Resend API response:', {
      status: resendResponse.status,
      ok: resendResponse.ok,
      data: resendData // Be mindful of logging sensitive data if any
    });

    if (!resendResponse.ok) {
      console.error('Resend API error:', resendData);
      // Don't block the webhook completion, but log the error
      // Optionally, you could implement retries or alert monitoring
      return new Response(JSON.stringify({ warning: 'Booking confirmed, but failed to send email', details: resendData }), {
        status: 502, // Bad Gateway or similar, indicating an upstream failure
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log('Successfully sent email for booking ID:', booking.id);
    return new Response(JSON.stringify({ success: true, message: "Email sent successfully", resend_id: resendData?.id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Critical error in send-booking-confirmation:', error);
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
