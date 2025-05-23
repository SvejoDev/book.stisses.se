import { json } from '@sveltejs/kit';
import { supabase } from '$lib/supabaseClient';

interface PriceGroup {
    id: number;
    experience_id: number | null;
    start_location_id: number | null;
    internal_name: string;
    display_name: string;
    price: number;
    is_payable: boolean;
    created_at: string | null;
    updated_at: string | null;
}

export const GET = async ({ url }: { url: URL }) => {
    const startLocationId = url.searchParams.get('startLocationId');
    const experienceId = url.searchParams.get('experienceId');
    
    if (!experienceId) {
        return new Response('Experience ID is required', { status: 400 });
    }

    try {
        // Build the filter conditions following the same pattern as durations
        // Order of specificity:
        // 1. Specific to this experience and start location
        // 2. Specific to this experience (any start location)
        // 3. Global price groups (if needed in the future)
        let filters = [`experience_id.eq.${experienceId}`];

        if (startLocationId && startLocationId !== '0') {
            // Include both location-specific and location-agnostic price groups for this experience
            filters = [
                `and(experience_id.eq.${experienceId},start_location_id.eq.${startLocationId})`,
                `and(experience_id.eq.${experienceId},start_location_id.is.null)`
            ];
        } else {
            // Only get price groups without location restriction for this experience
            filters = [`and(experience_id.eq.${experienceId},start_location_id.is.null)`];
        }

        const { data: priceGroupsData, error } = await supabase
            .from('price_groups')
            .select('*')
            .or(filters.join(','))
            .order('display_name');

        if (error) {
            console.error('Supabase query error:', error);
            throw error;
        }

        // Transform the data and remove duplicates based on internal_name or id
        // Prioritize more specific entries (with start_location_id) over general ones
        const priceGroupMap = new Map<number, PriceGroup>();

        for (const priceGroup of (priceGroupsData || []) as PriceGroup[]) {
            const existingGroup = priceGroupMap.get(priceGroup.id);
            
            // If the price group doesn't exist yet, or if this version is more specific, use it
            if (!existingGroup || (priceGroup.start_location_id !== null && existingGroup.start_location_id === null)) {
                priceGroupMap.set(priceGroup.id, priceGroup);
            }
        }

        const priceGroups = Array.from(priceGroupMap.values());
        return json(priceGroups);
    } catch (error) {
        console.error('Error fetching price groups:', error);
        return new Response('Failed to fetch price groups', { status: 500 });
    }
}; 