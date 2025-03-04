import { supabase } from "$lib/supabaseClient";
import { error } from '@sveltejs/kit';


export async function load({ params }) {
    const { experienceId } = params;
    const { data, error: supabaseError } = await supabase
        .from("experiences")
        .select("*")
        .eq("id", experienceId)
        .single();

    if (supabaseError) {
        error(500, "Failed to load experience");
    }

    // Add type validation
    const validTypes = ['private', 'school', 'company'];
    if (!validTypes.includes(data.type)) {
        error(400, "Invalid experience type");
    }

    return {
        experience: data
    };
}