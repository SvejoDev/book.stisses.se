// src/routes/api/create-payment-intent/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2023-10-16'
});

export const POST: RequestHandler = async ({ request }) => {
    try {
        const { amount, bookingData } = await request.json();

        // Create a payment intent
        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency: 'sek',
            metadata: {
                booking_number: bookingData.bookingNumber
            }
        });

        return json({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
        console.error('Error creating payment intent:', error);
        return new Response(JSON.stringify({ error: 'Failed to create payment intent' }), { 
            status: 500 
        });
    }
};