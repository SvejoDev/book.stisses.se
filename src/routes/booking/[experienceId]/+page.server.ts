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

    return {
        experience: data
    };
}