import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';

interface Product {
    id: number;
    name: string;
    description: string;
    total_quantity: number;
    image_url: string;
    price?: number | null;
}

interface ProductResponse {
    product_id: number;
    price?: number;
    products: Product;
}

export const GET: RequestHandler = async ({ url }) => {
    const startLocationId = url.searchParams.get('startLocationId');
    const experienceId = url.searchParams.get('experienceId');
    
    console.log('Fetching products with:', { startLocationId, experienceId });

    if (!experienceId) {
        return new Response('Experience ID is required', { status: 400 });
    }

    try {
        // Query for products in order of specificity:
        // 1. Products assigned to this experience with null start_location_id (base products)
        // 2. If a start location is selected, also include products specific to that location
        const { data: productsData, error } = await supabase
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
            .eq('experience_id', experienceId)
            .or(
                startLocationId && startLocationId !== '0' 
                    ? `start_location_id.is.null,start_location_id.eq.${startLocationId}`
                    : 'start_location_id.is.null'
            );

        if (error) {
            console.error('Supabase query error:', error);
            throw error;
        }

        console.log('Raw products data:', productsData);

        // Transform the data and remove duplicates based on product_id
        const seenProducts = new Set<number>();
        const products = ((productsData || []) as unknown as ProductResponse[])
            .map(item => ({
                ...item.products,
                imageUrl: item.products.image_url,
                price: item.price || null
            }))
            .filter((product): product is (Product & { imageUrl: string; price: number | null }) => {
                if (!product || seenProducts.has(product.id)) return false;
                seenProducts.add(product.id);
                return true;
            });
        
        console.log('Transformed products:', products);
        return json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        return new Response('Failed to fetch products', { status: 500 });
    }
}; 