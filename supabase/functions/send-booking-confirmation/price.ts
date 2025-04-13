// price.ts
// Import shared constants
const VAT_RATE = 0.25; // 25% VAT in Sweden

// Types matching the frontend
interface PriceResult {
    priceExcludingVat: number;
    priceIncludingVat: number;
}

type ExperienceType = 'private' | 'company' | 'school';

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
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(price);
}

/**
 * Gets both VAT-inclusive and VAT-exclusive prices
 * @param price - Total price (including VAT)
 * @param experienceType - Type of experience
 * @returns Object containing both prices
 */
export function getBothPrices(price: number, experienceType: ExperienceType): PriceResult {
    const priceExcludingVat = removeVat(price);
    return {
        priceExcludingVat,
        priceIncludingVat: price
    };
} 