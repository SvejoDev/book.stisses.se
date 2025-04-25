import { json } from '@sveltejs/kit';
import { supabase } from '$lib/supabaseClient';

export async function GET({ params }) {
	const { id } = params;
	const { data, error } = await supabase
		.from('addons')
		.select('id, name')
		.in('id', id.split(',').map(Number));

	if (error) {
		return json({ error: error.message }, { status: 500 });
	}

	return json({ addons: data });
} 