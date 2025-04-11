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

function formatPrice(price: number): string {
  return new Intl.NumberFormat('sv-SE').format(price);
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

    // Calculate totals (similar to your success page)
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
    const isPrivate = booking.experience?.type === 'private';
    const vatAmount = isPrivate ? total - total / 1.25 : total * 0.25;
    const displayTotal = isPrivate ? total : total + vatAmount;

    // Generate email HTML
    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            .wrapper {
              padding-top: 50px !important;
              font-family: Arial, sans-serif;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }

            hr {
              background-color: #ddd;
              height: 1px;
              border: 0;
              margin: 20px 0;
            }

            * {
              color: #3e3e3e;
            }

            table {
              font-size: 12px;
              width: 100%;
              margin-top: 10px;
              margin-bottom: 10px;
              border-collapse: collapse;
            }

            table th {
              text-align: left;
              padding: 8px;
              border-bottom: 1px solid #ddd;
            }

            table td {
              padding: 8px;
              border-bottom: 1px solid #eee;
            }

            .order-item-box {
              border-width: 1px;
              border-color: #ddd;
              border-style: solid;
              padding: 10px 10px;
              margin-top: 10px;
              background-color: #fff;
              overflow-x: auto;
            }

            .header {
              text-align: center;
              margin-bottom: 30px;
            }

            .header img {
              max-width: 150px;
              margin-bottom: 20px;
            }

            .booking-info {
              background-color: #f8f9fa;
              padding: 15px;
              border-radius: 5px;
              margin-bottom: 20px;
            }

            .total-section {
              background-color: #f8f9fa;
              padding: 15px;
              border-radius: 5px;
              margin-top: 20px;
            }

            .total-section table {
              margin: 0;
            }

            .total-section td {
              padding: 5px 8px;
              border: none;
            }

            .total-section tr:last-child {
              font-weight: bold;
              font-size: 14px;
            }

            .footer {
              text-align: center;
              margin-top: 30px;
              color: #666;
              font-size: 12px;
              border-top: 1px solid #ddd;
              padding-top: 20px;
            }
          </style>
        </head>
        <body>
          <div class="wrapper">
            <div class="header">
              <img src="https://stisses.se/images/logo.png" alt="Stisses" />
              <h2>Betallänk har betalats</h2>
              <p>${booking.booking_number}, ${booking.first_name} ${booking.last_name}</p>
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
                      <td>${group.price_at_time ? `${formatPrice(group.price_at_time)} kr` : '0,00 kr'}</td>
                      <td>${group.price_at_time ? `${formatPrice(group.price_at_time * 0.25)} kr (25%)` : '0,00 kr (25%)'}</td>
                    </tr>
                  `).join('')}

                  ${booking.booking_products.map(product => `
                    <tr>
                      <td>${product.products.name}</td>
                      <td>${product.quantity}</td>
                      <td>${product.price_at_time ? `${formatPrice(product.price_at_time)} kr` : '0,00 kr'}</td>
                      <td>${product.price_at_time ? `${formatPrice(product.price_at_time * 0.25)} kr (25%)` : '0,00 kr (25%)'}</td>
                    </tr>
                  `).join('')}

                  ${booking.booking_addons.map(addon => `
                    <tr>
                      <td>${addon.addons.name}</td>
                      <td>${addon.quantity}</td>
                      <td>${addon.price_at_time ? `${formatPrice(addon.price_at_time)} kr` : '0,00 kr'}</td>
                      <td>${addon.price_at_time ? `${formatPrice(addon.price_at_time * 0.25)} kr (25%)` : '0,00 kr (0%)'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>

            <div class="total-section">
              <table>
                <tr>
                  <td>Totalt (exkl. moms)</td>
                  <td style="text-align: right">${formatPrice(total)} kr</td>
                </tr>
                <tr>
                  <td>Moms</td>
                  <td style="text-align: right">${formatPrice(vatAmount)} kr</td>
                </tr>
                <tr>
                  <td>Totalt pris</td>
                  <td style="text-align: right">${formatPrice(displayTotal)} kr</td>
                </tr>
                <tr>
                  <td>Betalat</td>
                  <td style="text-align: right">${formatPrice(displayTotal)} kr</td>
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
