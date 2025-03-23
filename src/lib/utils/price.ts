export const VAT_RATE = 0.25; // 25% moms i Sverige

export function addVat(price: number): number {
    return price * (1 + VAT_RATE);
}

export function removeVat(priceWithVat: number): number {
    return priceWithVat / (1 + VAT_RATE);
}

export function formatPrice(price: number): string {
    return new Intl.NumberFormat('sv-SE', {
        style: 'currency',
        currency: 'SEK',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(price);
} 