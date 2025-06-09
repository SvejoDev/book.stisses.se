import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client with service role
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const now = new Date()
    console.log('Starting cleanup at:', now.toISOString())

    // 1. Find expired reservations (but not those in payment process)
    const { data: expiredReservations, error: expiredError } = await supabase
      .from('pending_bookings')
      .select('*')
      .eq('availability_reserved', true)
      .lt('expires_at', now.toISOString())
      .is('session_id', null)

    if (expiredError) throw expiredError

    // 2. Find processed bookings older than 1 hour
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
    const { data: processedBookings, error: processedError } = await supabase
      .from('pending_bookings')
      .select('*')
      .eq('availability_reserved', false)
      .lt('created_at', oneHourAgo.toISOString())

    if (processedError) throw processedError

    const allExpiredBookings = [
      ...(expiredReservations || []),
      ...(processedBookings || [])
    ]

    console.log(`Found ${allExpiredBookings.length} expired bookings to clean up`)

    const cleanupResults = []

    for (const booking of allExpiredBookings) {
      try {
        // Call your existing cleanup API endpoint
        const cleanupResponse = await fetch(`${Deno.env.get('SITE_URL')}/api/cleanup-expired`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            bookingNumber: booking.booking_number
          })
        })

        if (cleanupResponse.ok) {
          cleanupResults.push({
            bookingNumber: booking.booking_number,
            success: true
          })
          console.log(`Successfully cleaned up: ${booking.booking_number}`)
        } else {
          cleanupResults.push({
            bookingNumber: booking.booking_number,
            success: false,
            error: `HTTP ${cleanupResponse.status}`
          })
        }
      } catch (error) {
        console.error(`Failed to cleanup ${booking.booking_number}:`, error)
        cleanupResults.push({
          bookingNumber: booking.booking_number,
          success: false,
          error: error.message
        })
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: now.toISOString(),
        cleanedUp: cleanupResults.filter(r => r.success).length,
        failed: cleanupResults.filter(r => !r.success).length,
        results: cleanupResults
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    console.error('Cleanup function error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      },
    )
  }
}) 