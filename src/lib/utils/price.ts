export const VAT_RATE = 0.25; // 25% moms i Sverige

// Define customer types that are exempt from VAT
export const VAT_EXEMPT_TYPES = ['company', 'school'];

// Check if a customer type is exempt from VAT
export function isVatExempt(experienceType: string): boolean {
    return VAT_EXEMPT_TYPES.includes(experienceType);
}

export function addVat(price: number, experienceType: string): number {
    return isVatExempt(experienceType) ? price : price * (1 + VAT_RATE);
}

export function removeVat(priceWithVat: number, experienceType: string): number {
    return isVatExempt(experienceType) ? priceWithVat : priceWithVat / (1 + VAT_RATE);
}

export function calculateVatAmount(price: number, experienceType: string): number {
    return isVatExempt(experienceType) ? 0 : price * VAT_RATE;
}

export function formatPrice(price: number): string {
    return new Intl.NumberFormat('sv-SE', {
        style: 'currency',
        currency: 'SEK',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(price);
}

// Helper function to get the total price with or without VAT based on customer type
export function getTotalWithVat(basePrice: number, experienceType: string): number {
    return isVatExempt(experienceType) ? basePrice : addVat(basePrice, experienceType);
} 