import { supabase } from "$lib/supabaseClient";
import { error } from '@sveltejs/kit';

interface Product {
    id: number;
    name: string;
    description: string;
    total_quantity: number;
    image_url: string;
}

export async function load({ params }) {
    const { experienceId } = params;
    const today = new Date().toISOString().split('T')[0];
    

    // Fetch experience details
    const { data: experience, error: experienceError } = await supabase
        .from("experiences")
        .select("*")
        .eq("id", experienceId)
        .single();

    if (experienceError) {
        console.error('Experience error:', experienceError);
        error(500, "Failed to load experience");
    }

    // Add type validation
    const validTypes = ['private', 'school', 'company'];
    if (!validTypes.includes(experience.type)) {
        error(400, "Invalid experience type");
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
        error(500, "Failed to load start locations");
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
        error(500, "Failed to load price groups");
    }

    // Fetch open dates for this experience using simpler query first
    const { data: openDates, error: openDatesError } = await supabase
        .from("experience_open_dates")
        .select("*")
        .eq("experience_id", experienceId);

    if (openDatesError) {
        console.error('Open dates error:', openDatesError);
        error(500, "Failed to load open dates");
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
        error(500, "Failed to load blocked dates");
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