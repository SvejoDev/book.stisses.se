// import type { Database } from '../../database.types'; // Uncomment when you have generated types
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';

const supabaseUrl = PUBLIC_SUPABASE_URL;
const supabaseKey = SUPABASE_SERVICE_ROLE_KEY;

// export const supabaseServer = createClient<Database>(supabaseUrl, supabaseKey); // Use when types are ready
export const supabaseServer = createClient(supabaseUrl, supabaseKey);
