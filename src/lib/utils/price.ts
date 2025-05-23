import type { ExperienceType } from '$lib/types/price';
import { VAT_RATE } from '$lib/types/price';

/**
 * Determines if prices should be displayed including VAT based on experience type
 * @param experienceType - Type of experience (private, company, school)
 * @returns boolean - true if prices should include VAT in display
 */
export function shouldIncludeVatInDisplay(experienceType: string): boolean {
    // Only private experiences show prices with VAT
    return experienceType === 'private';
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
 * @param priceIncludingVat - Price including VAT
 * @returns Price excluding VAT
 */
export function removeVat(priceIncludingVat: number): number {
    return priceIncludingVat / (1 + VAT_RATE);
}

/**
 * Calculates the VAT amount from a price with VAT
 * @param priceIncludingVat - Price including VAT
 * @returns VAT amount
 */
export function calculateVatAmount(priceIncludingVat: number): number {
    return priceIncludingVat - removeVat(priceIncludingVat);
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

/**
 * Gets both prices (with and without VAT) based on the base price
 * 
 * @param basePrice - The base price (excluding VAT)
 * @param experienceType - Type of experience (private, company, school)
 * @returns Object containing both prices: with and without VAT
 */
export function getBothPrices(basePrice: number, experienceType: ExperienceType): { 
    priceExcludingVat: number;
    priceIncludingVat: number;
} {
    return {
        priceExcludingVat: basePrice,
        priceIncludingVat: addVat(basePrice)
    };
}

/**
 * Gets the display price to show to the user based on experience type
 * @param basePrice - The base price from database (always excluding VAT)
 * @param experienceType - Type of experience
 * @returns Price to display to the user
 */
export function getDisplayPrice(basePrice: number, experienceType: ExperienceType): number {
    // For 'private' experiences, we need to show prices including VAT
    // For 'company' and 'school', we show prices excluding VAT
    return experienceType === 'private' ? addVat(basePrice) : basePrice;
}

/**
 * Get the payment price (always including VAT)
 * @param basePrice - The base price (excluding VAT)
 * @param experienceType - Type of experience
 * @returns Final price including VAT for payment
 */
export function getPaymentPrice(basePrice: number, experienceType: ExperienceType): number {
    return addVat(basePrice);
} 