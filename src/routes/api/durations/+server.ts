import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/public';

export const GET: RequestHandler = async ({ url }) => {
    const startLocationId = url.searchParams.get('startLocationId');
    
    if (!startLocationId) {
        return new Response('Start location ID is required', { status: 400 });
    }

    try {
        const response = await fetch(`${env.PUBLIC_SUPABASE_URL}/rest/v1/start_location_durations?start_location_id=eq.${startLocationId}&order=duration_value.asc`, {
            headers: {
                'apikey': env.PUBLIC_SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${env.PUBLIC_SUPABASE_ANON_KEY}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch from Supabase');
        }

        const result = await response.json();
        return json(result);
    } catch (error) {
        console.error('Error fetching durations:', error);
        return new Response('Failed to fetch durations', { status: 500 });
    }
}; 