import { VAT_RATE } from '../../lib/types/price.types';
import { formatPrice as sharedFormatPrice } from '../../lib/utils/price';

// Helper to format date and time in Swedish
export function formatDateTime(date: string, time: string): string {
  const dateTime = new Date(`${date}T${time}`);
  return dateTime.toLocaleString('sv-SE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatDate(date: string): string {
  const dateObj = new Date(date);
  return dateObj.toLocaleString('sv-SE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

export function formatTime(time: string): string {
  const [hours, minutes] = time.split(':');
  return `${hours}:${minutes}`;
}

export function getDateTimeDisplay(booking: any): string {
  const isSameDay = booking.start_date === booking.end_date;
  if (isSameDay) {
    return `${formatDate(booking.start_date)} ${formatTime(booking.start_time)} till ${formatTime(booking.end_time)}`;
  } else {
    return `${formatDate(booking.start_date)} ${formatTime(booking.start_time)} till ${formatDate(booking.end_date)} ${formatTime(booking.end_time)}`;
  }
}

export function getDurationText(type: string, value: number): string {
  if (type === 'hours') {
    return value === 1 ? '1 timme' : `${value} timmar`;
  } else if (type === 'overnights') {
    return value === 1 ? '1 övernattning' : `${value} övernattningar`;
  }
  return '';
}

export const formatPrice = sharedFormatPrice;

// generateEmailHtml will be imported and used in index.ts
export function generateEmailHtml(booking: any): string {
    // Helper to safely access nested properties
    const get = (obj: any, path: string, defaultValue: any = null) => {
        const keys = path.split('.');
        let result = obj;
        for (const key of keys) {
            result = result?.[key];
            if (result === undefined || result === null) {
                return defaultValue;
            }
        }
        return result;
    };

    // Price calculations
    const totalPriceIncludingVat = booking.total_price || 0;
    const totalPriceExcludingVat = totalPriceIncludingVat / (1 + VAT_RATE);
    const totalVatAmount = totalPriceIncludingVat - totalPriceExcludingVat;

    const bookingPriceGroupsHtml = (booking.booking_price_groups || []).map((group: any) => {
        const priceExclVat = get(group, 'price_at_time', 0);
        const itemVat = priceExclVat * VAT_RATE;
        return `
        <tr>
            <td>${get(group, 'price_groups.display_name', 'Okänd grupp')}</td>
            <td style="text-align: center;">${get(group, 'quantity', 0)}</td>
            <td style="text-align: right;">${formatPrice(priceExclVat)}</td>
            <td style="text-align: right;">${formatPrice(itemVat)}</td>
        </tr>
    `;
    }).join('');

    const bookingProductsHtml = (booking.booking_products || []).map((product: any) => {
        const priceExclVat = get(product, 'price_at_time', 0);
        const itemVat = priceExclVat * VAT_RATE;
        return `
        <tr>
            <td>${get(product, 'products.name', 'Okänd produkt')}</td>
            <td style="text-align: center;">${get(product, 'quantity', 0)}</td>
            <td style="text-align: right;">${formatPrice(priceExclVat)}</td>
            <td style="text-align: right;">${formatPrice(itemVat)}</td>
        </tr>
    `;
    }).join('');

    const bookingAddonsHtml = (booking.booking_addons || []).map((addon: any) => {
        const priceExclVat = get(addon, 'price_at_time', 0);
        const itemVat = priceExclVat * VAT_RATE;
        return `
        <tr>
            <td>${get(addon, 'addons.name', 'Okänt tillägg')}</td>
            <td style="text-align: center;">${get(addon, 'quantity', 0)}</td>
            <td style="text-align: right;">${formatPrice(priceExclVat)}</td>
            <td style="text-align: right;">${formatPrice(itemVat)}</td>
        </tr>
    `;
    }).join('');

    // Calculate Duration Cost
    const payingCustomersCount = (booking.booking_price_groups || []).reduce((sum: number, group: any) => sum + get(group, 'quantity', 0), 0);
    const durationExtraPrice = get(booking, 'duration.extra_price', 0);
    const durationCostExclVat = durationExtraPrice * payingCustomersCount;
    const durationItemVat = durationCostExclVat * VAT_RATE;

    let durationHtml = '';
    if (durationCostExclVat > 0) {
        durationHtml = `
        <tr>
            <td>Avgift för tidslängd (${getDurationText(get(booking, 'duration.duration_type'), get(booking, 'duration.duration_value'))})</td>
            <td style="text-align: center;">(${payingCustomersCount} pers × ${formatPrice(durationExtraPrice)})</td>
            <td style="text-align: right;">${formatPrice(durationCostExclVat)}</td>
            <td style="text-align: right;">${formatPrice(durationItemVat)}</td>
        </tr>
        `;
    }

    const siteUrl = Deno.env.get('PUBLIC_SITE_URL') || 'http://localhost:5173';
    const bookingGuaranteeHtml = booking.has_booking_guarantee ? `
        <div class="section">
            <h2>Ombokningsgaranti</h2>
            <p>Du har köpt ombokningsgaranti för denna bokning. Om du behöver omboka din tid, klicka på länken nedan:</p>
            <p style="text-align: center; margin-top: 16px;">
                <a href="${siteUrl}/booking/reschedule/${booking.id}" 
                   style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                    Omboka din tid
                </a>
            </p>
            <p style="font-size: 12px; color: #6b7280; margin-top: 8px;">
                Länken är giltig fram till 24 timmar innan din bokade tid.
            </p>
        </div>
    ` : '';

    const commentHtml = booking.comment ? `
        <div class="section comment-section">
            <h3>Meddelande från dig</h3>
            <p>${booking.comment.replace(/\n/g, '<br>')}</p>
        </div>
    ` : '';

    return `...full HTML as in index.ts...`;
} 