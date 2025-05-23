import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';
import type { Product, ProductResponse } from '$lib/types';

export const GET: RequestHandler = async ({ url }) => {
    const startLocationId = url.searchParams.get('startLocationId');
    const experienceId = url.searchParams.get('experienceId');
    const pricingType = url.searchParams.get('pricingType') || 'per_person';
    

    if (!experienceId) {
        return new Response('Experience ID is required', { status: 400 });
    }

    try {
        // Build the filter conditions
        const filters = [
            // Base products for this experience
            `and(experience_id.eq.${experienceId},start_location_id.is.null)`
        ];

        // Add location-specific conditions if a start location is selected
        if (startLocationId && startLocationId !== '0') {
            // Global products for this location
            filters.push(`and(experience_id.is.null,start_location_id.eq.${startLocationId})`);
            // Specific products for both experience and location
            filters.push(`and(experience_id.eq.${experienceId},start_location_id.eq.${startLocationId})`);
        }

        const { data, error } = await supabase
            .from('experience_start_location_products')
            .select(`
                product_id,
                price,
                products (
                    id,
                    name,
                    description,
                    total_quantity,
                    image_url
                )
            `)
            .or(filters.join(','));

        if (error) {
            console.error('Supabase query error:', error);
            throw error;
        }

        // Transform the data and remove duplicates
        const productMap = new Map<number, Product & { imageUrl: string; price: number | null }>();

        // Type assertion for the response data
        const productsData = (data || []) as unknown as ProductResponse[];

        for (const item of productsData) {
            if (!item.products) continue;
            
            const existingProduct = productMap.get(item.products.id);
            const newProduct = {
                id: item.products.id,
                name: item.products.name,
                description: item.products.description,
                total_quantity: item.products.total_quantity,
                image_url: item.products.image_url,
                imageUrl: item.products.image_url,
                price: pricingType === 'per_person' ? null : item.price
            };

            // If the product doesn't exist yet, or if this version is more specific, use it
            if (!existingProduct || (item.price !== null && existingProduct.price === null)) {
                productMap.set(item.products.id, newProduct);
            }
        }

        const products = Array.from(productMap.values());
        return json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        return new Response('Failed to fetch products', { status: 500 });
    }
}; 