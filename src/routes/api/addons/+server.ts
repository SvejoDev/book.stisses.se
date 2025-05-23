import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';
import type { Addon, AddonEntry } from '$lib/types/addon';

export const GET: RequestHandler = async ({ url }) => {
    const startLocationId = url.searchParams.get('startLocationId');
    const experienceId = url.searchParams.get('experienceId');
    const pricingType = url.searchParams.get('pricingType') || 'per_person';
    const productIds = url.searchParams.getAll('productIds[]').map(Number);
    
    if (!experienceId) {
        return new Response('Experience ID is required', { status: 400 });
    }

    try {
        // Use a simple approach: Get all rows and filter in JavaScript
        // This gives us full control over the filtering logic
        const { data, error } = await supabase
            .from('experience_start_location_products_addons')
            .select(`
                id,
                experience_id,
                start_location_id,
                product_id,
                addon_id,
                price,
                addons (
                    id,
                    name,
                    description,
                    total_quantity,
                    image_url,
                    pricing_type
                )
            `);

        if (error) {
            console.error('Supabase query error:', error);
            return new Response(JSON.stringify({ error: error.message }), { 
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!data) {
            console.error('No data returned from Supabase');
            return new Response(JSON.stringify({ error: 'No data returned from database' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        // Now filter the data manually to ensure we only get:
        // 1. Addons for this experience OR global addons (experience_id IS NULL)
        // 2. Apply other filters (startLocation, productIds) as needed
        let filteredData = (data || []) as unknown as AddonEntry[];

        // First, filter by experience_id
        filteredData = filteredData.filter(item => 
            item.experience_id === parseInt(experienceId) || 
            item.experience_id === null
        );

        // Filter by start location if specified
        if (startLocationId && startLocationId !== '0') {
            filteredData = filteredData.filter(item => 
                item.start_location_id === parseInt(startLocationId) || 
                item.start_location_id === null
            );
        }

        // Filter by product if products are selected
        if (productIds.length > 0) {
            filteredData = filteredData.filter(item => 
                item.product_id === null || 
                productIds.includes(item.product_id)
            );
        }
        // Transform the filtered data and remove duplicates
        const addonMap = new Map<number, Addon>();

        for (const item of filteredData) {
            if (!item.addons) continue;
            
            const existingAddon = addonMap.get(item.addons.id);
            const newAddon: Addon = {
                id: item.addons.id,
                name: item.addons.name,
                description: item.addons.description,
                total_quantity: item.addons.total_quantity,
                image_url: item.addons.image_url,
                imageUrl: item.addons.image_url,
                price: item.price,
                pricing_type: item.addons.pricing_type
            };

            // If the addon doesn't exist yet, or if this version is more specific, use it
            if (!existingAddon || (item.price !== null && existingAddon.price === null)) {
                addonMap.set(item.addons.id, newAddon);
            }
        }

        const addons = Array.from(addonMap.values());
        return json(addons);
    } catch (error) {
        console.error('Error fetching addons:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Detailed error:', {
            message: errorMessage,
            stack: error instanceof Error ? error.stack : undefined
        });
        return new Response(JSON.stringify({ error: errorMessage }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}; 