import { json } from '@sveltejs/kit';
import Stripe from 'stripe';
import { SECRET_STRIPE_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';

const stripe = new Stripe(SECRET_STRIPE_KEY)

export const POST: RequestHandler = async ({ request }) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      comment,
      experienceId,
      experienceType,
      startLocationId,
      durationId,
      startDate,
      startTime,
      endDate,
      endTime,
      priceGroups,
      products,
      addons,
      totalPrice,
      hasBookingGuarantee
    } = await request.json();

    // Generate a unique booking number (you can customize this format)
    const bookingNumber = `BK-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create a new booking record with pending status
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .insert([
        {
          booking_number: bookingNumber,
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
          comment,
          experience_id: experienceId,
          experience_type: experienceType,
          start_location_id: startLocationId,
          duration_id: durationId,
          start_date: startDate,
          start_time: startTime,
          end_date: endDate,
          end_time: endTime,
          has_booking_guarantee: hasBookingGuarantee,
          total_price: totalPrice,
          is_paid: false
        }
      ])
      .select()
      .single();

    if (bookingError) throw bookingError;

    // Insert price groups
    if (Array.isArray(priceGroups)) {
      await supabase.from('booking_price_groups').insert(
        priceGroups.map((pg) => ({
          booking_id: booking.id,
          price_group_id: pg.id,
          quantity: pg.quantity,
          price_at_time: pg.price || 0
        }))
      );
    } else {
      const formattedPriceGroups = Object.entries(priceGroups).map(([id, quantity]) => ({
        booking_id: booking.id,
        price_group_id: parseInt(id),
        quantity,
        price_at_time: 0 // You might want to fetch the actual price here
      }));
      
      if (formattedPriceGroups.length > 0) {
        await supabase.from('booking_price_groups').insert(formattedPriceGroups);
      }
    }

    // Insert products
    await supabase.from('booking_products').insert(
      products.map((p: any) => ({
        booking_id: booking.id,
        product_id: p.productId,
        quantity: p.quantity,
        price_at_time: p.price
      }))
    );

    // Insert addons
    await supabase.from('booking_addons').insert(
      addons.map((a: any) => ({
        booking_id: booking.id,
        addon_id: a.addonId,
        quantity: a.quantity,
        price_at_time: a.price
      }))
    );

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'sek',
            product_data: {
              name: `Booking ${bookingNumber}`,
              description: `${experienceType} experience booking`,
              images: [products[0].image_url]
            },
            unit_amount: totalPrice * 100 // Convert to öre
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: `${request.headers.get('origin')}/booking/success?session_id={CHECKOUT_SESSION_ID}&booking_id=${booking.id}`,
      cancel_url: `${request.headers.get('origin')}/booking/cancel?booking_id=${booking.id}`,
      customer_email: email,
      metadata: {
        booking_id: booking.id,
        booking_number: bookingNumber
      }
    });

    return json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return json({ error: 'Could not create checkout session' }, { status: 500 });
  }
};