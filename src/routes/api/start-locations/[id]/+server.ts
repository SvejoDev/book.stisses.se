import { json } from '@sveltejs/kit';
import { supabase } from '$lib/supabaseClient';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }: { params: { id: string } }) => {
	const { id } = params;

	try {
		const { data, error } = await supabase
			.from('start_locations')
			.select('id, name')
			.eq('id', id)
			.single();

		if (error) {
			throw error;
		}

		return json({ startLocation: data });
	} catch (error) {
		console.error('Error fetching start location:', error);
		return json({ error: 'Failed to fetch start location' }, { status: 500 });
	}
}; 