import { addVat, removeVat, getBothPrices, VAT_RATE } from '../../lib/utils/price';

export { addVat, removeVat, getBothPrices, VAT_RATE };

export function calculatePriceExcludingVat(totalIncludingVat: number): number {
    return totalIncludingVat / (1 + VAT_RATE);
}

export function calculateVatAmountFromIncluded(totalIncludingVat: number): number {
    const priceExcludingVat = calculatePriceExcludingVat(totalIncludingVat);
    return totalIncludingVat - priceExcludingVat;
}

export function calculateVatAmountFromExcluded(priceExcludingVat: number): number {
    return priceExcludingVat * VAT_RATE;
} 