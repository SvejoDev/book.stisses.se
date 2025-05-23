// Price-related types
export const VAT_RATE = 0.25; // 25% VAT in Sweden

export type ExperienceType = 'private' | 'company' | 'school';

export interface PriceResult {
    priceExcludingVat: number;
    priceIncludingVat: number;
}

export interface PriceGroup {
    id: number;
    experience_id: number | null;
    start_location_id: number | null;
    internal_name: string;
    display_name: string;
    price: number;
    is_payable: boolean;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface PriceGroupSelection {
    id: number;
    quantity: number;
}

export interface BookingPriceGroup {
    quantity: number;
    price_groups: Array<{
        id: number;
        display_name: string;
    }>;
} 