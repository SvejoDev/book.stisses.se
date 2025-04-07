import { supabase } from "$lib/supabaseClient";
import { error } from '@sveltejs/kit';
import type { Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { superValidate } from 'sveltekit-superforms/server';
import  formSchema from '$lib/components/ContactForm.svelte';
export async function load({ params }) {
    const { experienceId } = params;
    
    // Validate experienceId
    if (!experienceId || isNaN(parseInt(experienceId))) {
        throw error(400, "Invalid experience ID");
    }
    
    const today = new Date().toISOString().split('T')[0];

    // Fetch experience details
    const { data: experience, error: experienceError } = await supabase
        .from("experiences")
        .select("*")
        .eq("id", experienceId)
        .single();

    if (experienceError) {
        console.error('Experience error:', experienceError);
        throw error(500, "Failed to load experience");
    }

    if (!experience) {
        throw error(404, "Experience not found");
    }

    // Add type validation
    const validTypes = ['private', 'school', 'company'];
    if (!validTypes.includes(experience.type)) {
        throw error(400, "Invalid experience type");
    }

    // Fetch start locations for this experience
    const { data: startLocations, error: startLocationsError } = await supabase
        .from("experience_start_locations")
        .select(`
            start_location_id,
            start_locations (
                id,
                name,
                image_url
            )
        `)
        .eq("experience_id", experienceId);

    if (startLocationsError) {
        console.error('Start locations error:', startLocationsError);
        throw error(500, "Failed to load start locations");
    }

    // Transform the nested structure to match the expected format
    const locationsWithImages = (startLocations || []).map((item: any) => ({
        id: item.start_locations.id,
        experience_id: parseInt(experienceId),
        name: item.start_locations.name,
        imageUrl: item.start_locations.image_url
    }));

    // Fetch price groups for this experience
    const { data: priceGroups, error: priceGroupsError } = await supabase
        .from("price_groups")
        .select("*")
        .eq("experience_id", experienceId);

    if (priceGroupsError) {
        console.error('Price groups error:', priceGroupsError);
        throw error(500, "Failed to load price groups");
    }

    // Fetch open dates for this experience using simpler query first
    const { data: openDates, error: openDatesError } = await supabase
        .from("experience_open_dates")
        .select("*")
        .eq("experience_id", experienceId);

    if (openDatesError) {
        console.error('Open dates error:', openDatesError);
        throw error(500, "Failed to load open dates");
    }

    // Filter open dates in JavaScript instead of SQL for debugging
    const filteredOpenDates = (openDates || []).filter(date => {
        if (date.type === 'interval') {
            return date.end_date >= today;
        } else {
            return date.specific_date >= today;
        }
    });

    // Fetch blocked dates for this experience
    const { data: blockedDates, error: blockedDatesError } = await supabase
        .from("experience_blocked_dates")
        .select("*")
        .eq("experience_id", experienceId)
        .gte('end_date', today);

    if (blockedDatesError) {
        console.error('Blocked dates error:', blockedDatesError);
        throw error(500, "Failed to load blocked dates");
    }

    // Create the return data
    const returnData = {
        experience,
        startLocations: locationsWithImages,
        openDates: filteredOpenDates,
        blockedDates: blockedDates || [],
        priceGroups: priceGroups || [],
        pricingType: experience.pricing_type
    };

    return returnData;
}

export const actions = {
  default: async ({ request }) => {
    const form = await superValidate(request, formSchema);
    
    if (!form.valid) {
      return fail(400, { form });
    }
    
    return { form };
  }
} satisfies Actions;