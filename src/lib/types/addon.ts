// Addon-related types
export interface Addon {
    id: number;
    name: string;
    description: string | null;
    total_quantity: number | null;
    image_url?: string | null;
    imageUrl?: string; // For backward compatibility
    created_at?: string;
    track_availability?: boolean | null;
    pricing_type?: string | null;
    price?: number | null;
}

export interface AddonWithPrice extends Addon {
    price: number | null;
    pricing_type: string;
}

export interface SelectedAddon {
    addonId: number;
    quantity: number;
    price: number;
}

export interface BookingAddon {
    quantity: number;
    price_at_time?: number;
    addons: {
        id: number;
        name: string;
        total_quantity: number;
        track_availability: boolean;
    };
}

export interface AddonEntry {
    id: number;
    experience_id: number | null;
    start_location_id: number | null;
    product_id: number | null;
    addon_id: number;
    price: number | null;
    addons: {
        id: number;
        name: string;
        description: string;
        total_quantity: number;
        image_url: string;
        pricing_type: string;
    };
} 