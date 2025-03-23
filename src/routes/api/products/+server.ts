import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';

interface Product {
    id: number;
    name: string;
    description: string;
    total_quantity: number;
    image_url: string;
}

interface ProductResponse {
    product_id: number;
    products: Product;
}

export const GET: RequestHandler = async ({ url }) => {
    const startLocationId = url.searchParams.get('startLocationId');
    const experienceId = url.searchParams.get('experienceId');
    
    if (!startLocationId || !experienceId) {
        return new Response('Start location ID and Experience ID are required', { status: 400 });
    }

    try {
        // Query for products in order of specificity:
        // 1. Specific to this experience and start location
        // 2. Specific to this experience (any start location)
        // 3. Specific to this start location (any experience)
        const { data: productsData, error } = await supabase
            .from('experience_start_location_products')
            .select(`
                product_id,
                products (
                    id,
                    name,
                    description,
                    total_quantity,
                    image_url
                )
            `)
            .or(`and(experience_id.eq.${experienceId},start_location_id.eq.${startLocationId}),and(experience_id.eq.${experienceId},start_location_id.is.null),and(experience_id.is.null,start_location_id.eq.${startLocationId})`);

        if (error) throw error;

        // Transform the data and remove duplicates based on product_id
        const seenProducts = new Set<number>();
        const products = ((productsData || []) as unknown as ProductResponse[])
            .map(item => ({
                ...item.products,
                imageUrl: item.products.image_url // Transform image_url to imageUrl for frontend consistency
            }))
            .filter((product): product is Product & { imageUrl: string } => {
                if (!product || seenProducts.has(product.id)) return false;
                seenProducts.add(product.id);
                return true;
            });
        
        return json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        return new Response('Failed to fetch products', { status: 500 });
    }
}; 