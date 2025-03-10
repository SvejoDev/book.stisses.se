import { supabase } from "$lib/supabaseClient";
import { error } from '@sveltejs/kit';


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
        .from("start_locations")
        .select("*")
        .eq("experience_id", experienceId);

    if (startLocationsError) {
        console.error('Start locations error:', startLocationsError);
        error(500, "Failed to load start locations");
    }

    // Get image URLs for each start location
    const locationsWithImages = await Promise.all(
        startLocations.map(async (location) => {
            const { data: imageUrl } = supabase.storage
                .from('start-locations')
                .getPublicUrl(`${location.id}.jpg`);
            
            return {
                ...location,
                imageUrl: imageUrl.publicUrl
            };
        })
    );

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
        blockedDates: blockedDates || []
    };

    // Log the final data structure

    return returnData;
}