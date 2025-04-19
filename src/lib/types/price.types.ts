export interface PriceResult {
    priceExcludingVat: number;
    priceIncludingVat: number;
}

export type ExperienceType = 'private' | 'company' | 'school';

export const VAT_RATE = 0.25; // 25% VAT in Sweden 