import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/public';

export const GET: RequestHandler = async ({ url }) => {
    const startLocationId = url.searchParams.get('startLocationId');
    
    if (!startLocationId) {
        return new Response('Start location ID is required', { status: 400 });
    }

    try {
        // First get the duration IDs for this start location
        const response = await fetch(
            `${env.PUBLIC_SUPABASE_URL}/rest/v1/start_location_durations?start_location_id=eq.${startLocationId}&select=duration_id`,
            {
                headers: {
                    'apikey': env.PUBLIC_SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${env.PUBLIC_SUPABASE_ANON_KEY}`
                }
            }
        );

        if (!response.ok) {
            throw new Error('Failed to fetch from Supabase');
        }

        const durationLinks = await response.json();
        const durationIds = durationLinks.map((link: { duration_id: number }) => link.duration_id);

        if (durationIds.length === 0) {
            return json([]);
        }

        // Then get the actual durations
        const durationsResponse = await fetch(
            `${env.PUBLIC_SUPABASE_URL}/rest/v1/durations?id=in.(${durationIds.join(',')})&order=duration_value.asc`,
            {
                headers: {
                    'apikey': env.PUBLIC_SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${env.PUBLIC_SUPABASE_ANON_KEY}`
                }
            }
        );

        if (!durationsResponse.ok) {
            throw new Error('Failed to fetch durations from Supabase');
        }

        const durations = await durationsResponse.json();
        return json(durations);
    } catch (error) {
        console.error('Error fetching durations:', error);
        return new Response('Failed to fetch durations', { status: 500 });
    }
}; 