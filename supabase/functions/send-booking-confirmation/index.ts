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
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; margin-bottom: 30px; }
            .section { margin-bottom: 20px; }
            .total { background-color: #f8f9fa; padding: 15px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Bokningsbekräftelse</h1>
              <p>Bokningsnummer: ${booking.booking_number}</p>
            </div>

            <div class="section">
              <h2>${booking.experience?.name}</h2>
              <p><strong>Startplats:</strong> ${booking.start_location?.name}</p>
              <p><strong>Längd:</strong> ${getDurationText(
                booking.duration?.duration_type,
                booking.duration?.duration_value
              )}</p>
            </div>

            <div class="section">
              <h3>Tidpunkt</h3>
              <p>Start: ${formatDateTime(booking.start_date, booking.start_time)}</p>
              <p>Slut: ${formatDateTime(booking.end_date, booking.end_time)}</p>
            </div>

            <div class="section">
              <h3>Kontaktuppgifter</h3>
              <p>${booking.first_name} ${booking.last_name}</p>
              <p>${booking.email}</p>
              <p>${booking.phone}</p>
            </div>

            ${booking.booking_price_groups.length ? `
              <div class="section">
                <h3>Antal personer</h3>
                ${booking.booking_price_groups.map(group => `
                  <p>${group.price_groups.display_name}: ${group.quantity} × ${
                    group.price_at_time ? `${formatPrice(group.price_at_time)} kr` : 'Ingår'
                  }</p>
                `).join('')}
              </div>
            ` : ''}

            ${booking.booking_products.length ? `
              <div class="section">
                <h3>Utrustning</h3>
                ${booking.booking_products.map(product => `
                  <p>${product.products.name}: ${product.quantity} × ${
                    product.price_at_time ? `${formatPrice(product.price_at_time)} kr` : 'Ingår'
                  }</p>
                `).join('')}
              </div>
            ` : ''}

            ${booking.booking_addons.length ? `
              <div class="section">
                <h3>Tillägg</h3>
                ${booking.booking_addons.map(addon => `
                  <p>${addon.addons.name}: ${addon.quantity} × ${
                    addon.price_at_time ? `${formatPrice(addon.price_at_time)} kr` : 'Ingår'
                  }</p>
                `).join('')}
              </div>
            ` : ''}

            <div class="total">
              <h3>Totalt att betala</h3>
              <p style="font-size: 1.2em; font-weight: bold;">
                ${formatPrice(displayTotal)} kr
                <br>
                <span style="font-size: 0.8em; font-weight: normal;">
                  ${isPrivate 
                    ? `(varav moms ${formatPrice(vatAmount)} kr)`
                    : `+ moms ${formatPrice(vatAmount)} kr`}
                </span>
              </p>
            </div>

            ${booking.comment ? `
              <div class="section">
                <h3>Meddelande</h3>
                <p>${booking.comment}</p>
              </div>
            ` : ''}

            <div style="text-align: center; margin-top: 30px; color: #666;">
              <p>Tack för din bokning! Spara denna bekräftelse.</p>
              <p>Vid frågor, kontakta oss på info@stisses.se</p>
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
