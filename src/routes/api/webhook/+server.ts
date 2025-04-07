// src/routes/api/webhook/+server.ts
import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { SECRET_STRIPE_KEY, STRIPE_WEBHOOK_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';

const stripe = new Stripe(SECRET_STRIPE_KEY)

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature!,
      STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    
    // Update booking status
    const { error } = await supabase
      .from('bookings')
      .update({ 
        is_paid: true,
        stripe_payment_id: session.payment_intent as string
      })
      .eq('id', session.metadata?.booking_id);

    if (error) {
      console.error('Error updating booking:', error);
      return json({ error: 'Failed to update booking' }, { status: 500 });
    }
  }

  return json({ received: true });
};