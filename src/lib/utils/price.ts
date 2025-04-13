import type { PriceResult, ExperienceType } from '$lib/types/price.types';
import { VAT_RATE } from '$lib/types/price.types';

// Define which experience types should show prices excluding VAT
export const SHOW_PRICES_EXCLUDING_VAT = ['private', 'company', 'school'];

// Check if prices should be shown excluding VAT
export function shouldShowPricesExcludingVat(experienceType: string): boolean {
    return SHOW_PRICES_EXCLUDING_VAT.includes(experienceType);
}

/**
 * Add VAT to a price that excludes VAT
 * @param priceExcludingVat - Price excluding VAT
 * @returns Price including VAT
 */
export function addVat(priceExcludingVat: number): number {
    return priceExcludingVat * (1 + VAT_RATE);
}

/**
 * Removes VAT from a price that includes VAT
 * @param priceWithVat - Price including VAT
 * @returns Price excluding VAT
 */
export function removeVat(priceWithVat: number): number {
    return priceWithVat / (1 + VAT_RATE);
}

/**
 * Calculates the VAT amount from a price that includes VAT
 * @param priceWithVat - Price including VAT
 * @returns VAT amount
 */
export function calculateVatAmount(priceWithVat: number): number {
    return priceWithVat - removeVat(priceWithVat);
}

/**
 * Formats a price for display in SEK
 * @param price - Price to format
 * @returns Formatted price string
 */
export function formatPrice(price: number): string {
    return new Intl.NumberFormat('sv-SE', {
        style: 'currency',
        currency: 'SEK',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(price);
}

// Get the final price to charge (always including VAT)
export function getFinalPrice(basePrice: number, experienceType: string): number {
    // If prices are shown excluding VAT, add VAT for the final charge
    if (shouldShowPricesExcludingVat(experienceType)) {
        return addVat(basePrice);
    }
    // If prices are shown including VAT, use as is
    return basePrice;
}

/**
 * Get the display price based on experience type
 * @param priceExcludingVat - Base price excluding VAT from database
 * @param experienceType - Type of experience
 * @returns Price to display (with VAT for private, without for business/school)
 */
export function getDisplayPrice(priceExcludingVat: number, experienceType: ExperienceType): number {
    return experienceType === 'private' ? addVat(priceExcludingVat) : priceExcludingVat;
}

/**
 * Gets both VAT-inclusive and VAT-exclusive prices
 * @param priceExcludingVat - Base price excluding VAT from database
 * @param experienceType - Type of experience
 * @returns Object containing both prices
 */
export function getBothPrices(priceExcludingVat: number, experienceType: ExperienceType): PriceResult {
    return {
        priceExcludingVat,
        priceIncludingVat: experienceType === 'private' ? addVat(priceExcludingVat) : priceExcludingVat
    };
} 