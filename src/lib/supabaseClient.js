import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
	'https://dquyorrwrlnlayfopymz.supabase.co',
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxdXlvcnJ3cmxubGF5Zm9weW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEwMzEyMjUsImV4cCI6MjA1NjYwNzIyNX0.k1hYkNihQdrYsLkb2i7T-3a-1E8kd3UTthwCBMx6IYE'
);
