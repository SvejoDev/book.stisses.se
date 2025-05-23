// import type { Database } from '../../database.types'; // Uncomment when you have generated types
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

const supabaseUrl = PUBLIC_SUPABASE_URL;
const supabaseKey = PUBLIC_SUPABASE_ANON_KEY;

// export const supabase = createClient<Database>(supabaseUrl, supabaseKey); // Use when types are ready
export const supabase = createClient(supabaseUrl, supabaseKey);
