// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Follow Deno and Supabase Edge Function conventions
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0"
import { format } from 'https://deno.land/x/date_fns@v2.22.1/format/index.js'
import { sv } from 'https://deno.land/x/date_fns@v2.22.1/locale/index.js'

// Price calculation functions
const VAT_RATE = 0.25; // 25% VAT in Sweden

function removeVat(priceIncludingVat: number): number {
    return priceIncludingVat / (1 + VAT_RATE);
}

function calculateVatAmount(priceIncludingVat: number): number {
    return priceIncludingVat - removeVat(priceIncludingVat);
}

function formatPrice(price: number): string {
    return new Intl.NumberFormat('sv-SE', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(price);
}

function getBothPrices(priceIncludingVat: number, experienceType: string): {
    priceExcludingVat: number;
    priceIncludingVat: number;
} {
    // All prices in database are already including VAT
    return {
        priceExcludingVat: removeVat(priceIncludingVat),
        priceIncludingVat: priceIncludingVat
    };
}

console.log('Edge Function initializing...');

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
console.log('RESEND_API_KEY present:', !!RESEND_API_KEY);

// These are automatically available in Edge Functions
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

console.log('SUPABASE_URL present:', !!supabaseUrl);
console.log('SUPABASE_SERVICE_ROLE_KEY present:', !!supabaseServiceRoleKey);

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

serve(async (req) => {
  try {
    console.log('Received request to send booking confirmation');
    
    // Log the request details
    console.log('Request headers:', Object.fromEntries(req.headers.entries()));
    
    const body = await req.json();
    console.log('Request body:', body);
    
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
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select(`
        *,
        experience:experiences!bookings_experience_id_fkey (
          id,
          name,
          type,
          pricing_type
        ),
        start_location:start_locations (
          id,
          name
        ),
        duration:durations (
          id,
          duration_type,
          duration_value,
          extra_price
        ),
        booking_price_groups (
          price_group_id,
          quantity,
          price_at_time,
          price_groups (
            id,
            display_name,
            price
          )
        ),
        booking_products (
          product_id,
          quantity,
          price_at_time,
          products (
            id,
            name
          )
        ),
        booking_addons (
          addon_id,
          quantity,
          price_at_time,
          addons (
            id,
            name
          )
        )
      `)
      .eq('id', bookingId)
      .single();

    if (bookingError) {
      console.error('Error fetching booking:', bookingError);
      return new Response(JSON.stringify({ error: 'Error fetching booking', details: bookingError }), {
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

    console.log('Found booking:', {
      id: booking.id,
      number: booking.booking_number,
      email: booking.email
    });

    // Calculate totals (exactly like the success page)
    const priceGroupTotal = booking.booking_price_groups.reduce(
      (sum, group) => sum + (group.price_at_time || 0) * group.quantity,
      0
    );

    const productTotal = booking.booking_products.reduce(
      (sum, product) => sum + (product.price_at_time || 0) * product.quantity,
      0
    );

    const addonTotal = booking.booking_addons.reduce(
      (sum, addon) => sum + (addon.price_at_time || 0) * addon.quantity,
      0
    );

    const payingCustomers = booking.booking_price_groups.reduce(
      (sum, group) => sum + group.quantity,
      0
    );

    const durationTotal = (booking.duration?.extra_price || 0) * payingCustomers;
    const total = priceGroupTotal + productTotal + addonTotal + durationTotal;
    
    // Get both prices for display using the same function as the success page
    const prices = getBothPrices(total, booking.experience?.type || 'private');
    const vatAmount = calculateVatAmount(prices.priceIncludingVat);

    // Generate email HTML
    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body {
              margin: 0;
              padding: 0;
              background-color: #ffffff;
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #2d3748;
            }

            .wrapper {
              padding: 40px 20px;
              max-width: 600px;
              margin: 0 auto;
              background-color: #ffffff;
            }

            hr {
              background-color: #e2e8f0;
              height: 1px;
              border: 0;
              margin: 20px 0;
            }

            h2 {
              color: #1a202c;
              font-size: 24px;
              margin-bottom: 10px;
            }

            h3 {
              color: #2d3748;
              font-size: 18px;
              margin-bottom: 8px;
            }

            table {
              font-size: 14px;
              width: 100%;
              margin: 10px 0;
              border-collapse: collapse;
              background-color: #ffffff;
            }

            table th {
              text-align: left;
              padding: 12px;
              background-color: #f7fafc;
              border-bottom: 2px solid #e2e8f0;
              color: #4a5568;
              font-weight: 600;
            }

            table td {
              padding: 12px;
              border-bottom: 1px solid #edf2f7;
              color: #4a5568;
            }

            .order-item-box {
              border: 1px solid #e2e8f0;
              border-radius: 8px;
              padding: 20px;
              margin: 20px 0;
              background-color: #ffffff;
              box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
            }

            .header {
              text-align: center;
              margin-bottom: 40px;
              padding-bottom: 30px;
              border-bottom: 1px solid #e2e8f0;
            }

            .header img {
              max-width: 180px;
              margin-bottom: 25px;
            }

            .header h2 {
              margin: 0 0 10px 0;
              color: #1a202c;
            }

            .header h3 {
              margin: 0 0 15px 0;
              color: #48bb78;
              font-weight: normal;
            }

            .header p {
              color: #4a5568;
              margin: 0;
            }

            .booking-info {
              background-color: #f7fafc;
              padding: 20px;
              border-radius: 8px;
              margin-bottom: 30px;
              border: 1px solid #e2e8f0;
            }

            .booking-info h3 {
              margin-top: 0;
              color: #2d3748;
            }

            .booking-info p {
              margin: 8px 0;
              color: #4a5568;
            }

            .booking-info strong {
              color: #2d3748;
            }

            .total-section {
              background-color: #f7fafc;
              padding: 20px;
              border-radius: 8px;
              margin-top: 30px;
              border: 1px solid #e2e8f0;
            }

            .total-section table {
              margin: 0;
              background-color: transparent;
            }

            .total-section td {
              padding: 8px 12px;
              border: none;
            }

            .total-section tr:last-child {
              font-weight: 600;
              font-size: 16px;
              color: #2d3748;
            }

            .total-section tr:last-child td {
              padding-top: 15px;
              border-top: 2px solid #e2e8f0;
            }

            .footer {
              text-align: center;
              margin-top: 40px;
              padding-top: 30px;
              border-top: 1px solid #e2e8f0;
              color: #718096;
              font-size: 13px;
            }

            .footer p {
              margin: 5px 0;
            }

            .footer strong {
              color: #4a5568;
            }

            .footer a {
              color: #4299e1;
              text-decoration: none;
            }

            .footer a:hover {
              text-decoration: underline;
            }

            @media only screen and (max-width: 600px) {
              .wrapper {
                padding: 20px 15px;
              }

              table {
                font-size: 13px;
              }

              .header h2 {
                font-size: 22px;
              }

              .header h3 {
                font-size: 16px;
              }
            }
          </style>
        </head>
        <body>
          <div class="wrapper">
            <div class="header">
              <img src="https://stisses.se/images/logo.png" alt="Stisses" />
              <h2>Bekräftelse & Kvitto</h2>
              <h3>Tack för din bokning!</h3>
              <p>Bokningsnummer: ${booking.booking_number}, ${booking.first_name} ${booking.last_name}</p>
            </div>

            <div class="booking-info">
              <h3>${getDateTimeDisplay(booking)}</h3>
              <p><strong>${booking.experience?.name}</strong></p>
              <p>Startplats: ${booking.start_location?.name}</p>
              <p>Längd: ${getDurationText(booking.duration?.duration_type, booking.duration?.duration_value)}</p>
            </div>

            <div class="order-item-box">
              <table>
                <thead>
                  <tr>
                    <th>Produkt</th>
                    <th>Antal</th>
                    <th>Pris</th>
                    <th>Moms</th>
                  </tr>
                </thead>
                <tbody>
                  ${booking.booking_price_groups.map(group => `
                    <tr>
                      <td>${group.price_groups.display_name}</td>
                      <td>${group.quantity}</td>
                      <td>${formatPrice(group.price_at_time || 0)} kr</td>
                      <td>${formatPrice(calculateVatAmount(group.price_at_time || 0))} kr (25%)</td>
                    </tr>
                  `).join('')}

                  ${booking.booking_products.map(product => `
                    <tr>
                      <td>${product.products.name}</td>
                      <td>${product.quantity}</td>
                      <td>${formatPrice(product.price_at_time || 0)} kr</td>
                      <td>${formatPrice(calculateVatAmount(product.price_at_time || 0))} kr (25%)</td>
                    </tr>
                  `).join('')}

                  ${booking.booking_addons.map(addon => `
                    <tr>
                      <td>${addon.addons.name}</td>
                      <td>${addon.quantity}</td>
                      <td>${formatPrice(addon.price_at_time || 0)} kr</td>
                      <td>${formatPrice(calculateVatAmount(addon.price_at_time || 0))} kr (25%)</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>

            <div class="total-section">
              <table>
                <tr>
                  <td>Totalt (exkl. moms)</td>
                  <td style="text-align: right">${formatPrice(prices.priceExcludingVat)} kr</td>
                </tr>
                <tr>
                  <td>Moms</td>
                  <td style="text-align: right">${formatPrice(vatAmount)} kr</td>
                </tr>
                <tr>
                  <td>Totalt pris</td>
                  <td style="text-align: right">${formatPrice(prices.priceIncludingVat)} kr</td>
                </tr>
                <tr>
                  <td>Betalat</td>
                  <td style="text-align: right">${formatPrice(prices.priceIncludingVat)} kr</td>
                </tr>
              </table>
            </div>

            ${booking.comment ? `
              <div class="order-item-box">
                <h3>Meddelande</h3>
                <p>${booking.comment}</p>
              </div>
            ` : ''}

            <div class="footer">
              <p><strong>Stisses Sport och Fritid AB</strong></p>
              <p>+46703259638</p>
              <p>559416-1308 (SE559416130801)</p>
              <p>Reningsverksvägen 2 26232 Ängelholm</p>
              <hr>
              <p>Några frågor? Kontakta oss på <a href="mailto:info@stisses.se">info@stisses.se</a></p>
              <p style="color: #999; font-size: 11px; margin-top: 20px;">© ${new Date().getFullYear()} Stisses Sport och Fritid AB | Ängelholm, Sweden. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `

    // Generate and send email
    console.log('Preparing to send email to:', booking.email);
    
    // Send email using Resend
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Stisses <noreply@svejo.se>',
        to: booking.email,
        subject: `Bokningsbekräftelse - ${booking.booking_number}`,
        html: emailHtml,
      }),
    });

    const resendData = await resendResponse.json();
    console.log('Resend API response:', {
      status: resendResponse.status,
      data: resendData
    });

    if (!resendResponse.ok) {
      console.error('Resend API error:', resendData);
      return new Response(JSON.stringify({ error: 'Failed to send email', details: resendData }), {
        status: resendResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log('Successfully sent email');
    return new Response(JSON.stringify({ success: true, data: resendData }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in send-booking-confirmation:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/send-booking-confirmation' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
