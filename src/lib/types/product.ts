// Product-related types
export interface Product {
    id: number;
    name: string;
    description: string | null;
    total_quantity: number;
    image_url?: string | null;
    imageUrl?: string; // For backward compatibility
    price?: number | null;
}

export interface ProductWithPrice extends Product {
    price: number | null;
}

export interface SelectedProduct {
    productId: number;
    quantity: number;
    price: number;
}

export interface BookingProduct {
    quantity: number;
    price_at_time?: number;
    products: {
        id: number;
        name: string;
        total_quantity: number;
    };
}

export interface ProductResponse {
    product_id: number;
    price: number | null;
    products: Product;
} 