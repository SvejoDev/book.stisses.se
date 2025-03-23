import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';


interface Duration {
    id: number;
    duration_type: string;
    duration_value: number;
    extra_price: number;
}

interface DurationResponse {
    duration_id: number;
    durations: Duration;
}


export const GET: RequestHandler = async ({ url }) => {
    const startLocationId = url.searchParams.get('startLocationId');
    const experienceId = url.searchParams.get('experienceId');
    
    if (!startLocationId || !experienceId) {
        return new Response('Start location ID and Experience ID are required', { status: 400 });
    }

    try {
        // Query for durations in order of specificity:
        // 1. Specific to this experience and start location
        // 2. Specific to this experience (any start location)
        // 3. Specific to this start location (any experience)
        const { data: durationsData, error } = await supabase
            .from('experience_start_location_durations')
            .select(`
                duration_id,
                durations (
                    id,
                    duration_type,
                    duration_value,
                    extra_price
                )
            `)
            .or(`and(experience_id.eq.${experienceId},start_location_id.eq.${startLocationId}),and(experience_id.eq.${experienceId},start_location_id.is.null),and(experience_id.is.null,start_location_id.eq.${startLocationId})`);

        if (error) throw error;

        // Transform the data and remove duplicates based on duration_id
        const seenDurations = new Set<number>();
        const durations = ((durationsData || []) as unknown as DurationResponse[])
            .map(item => item.durations)
            .filter((duration): duration is Duration => {
                if (!duration || seenDurations.has(duration.id)) return false;
                seenDurations.add(duration.id);
                return true;
            });
        
        return json(durations);
    } catch (error) {
        console.error('Error fetching durations:', error);
        return new Response('Failed to fetch durations', { status: 500 });
    }
};