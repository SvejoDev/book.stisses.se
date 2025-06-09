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

    const siteUrl = Deno.env.get('PUBLIC_SITE_URL') || 
                    (Deno.env.get('VERCEL_ENV') === 'production' 
                        ? 'https://book-stisses-se.vercel.app' 
                        : 'http://localhost:5173');
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

    return `
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Bokningsbekräftelse - Stisses</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; background: #f9fafb; color: #222; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 32px auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px #0001; padding: 32px; }
          h1, h2, h3 { color: #4f46e5; }
          .section { margin-bottom: 32px; }
          .details-table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          .details-table th, .details-table td { border: 1px solid #e5e7eb; padding: 8px; }
          .details-table th { background: #f3f4f6; text-align: left; }
          .totals-table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          .totals-table td { padding: 8px; }
          .totals-table .label { text-align: right; color: #6b7280; }
          .totals-table .value { text-align: right; font-weight: bold; }
          .comment-section { background: #f3f4f6; border-radius: 6px; padding: 16px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Bokningsbekräftelse</h1>
          <div class="section">
            <h2>Hej${booking.name ? ` ${booking.name}` : ''}!</h2>
            <p>Tack för din bokning hos Stisses. Här är din bokningsbekräftelse.</p>
            <p><strong>Bokningsnummer:</strong> ${booking.booking_number}</p>
          </div>

          <div class="section">
            <h2>Bokningsdetaljer</h2>
            <table class="details-table">
              <tr>
                <th>Upplevelse</th>
                <td>${get(booking, 'experience.name', 'Okänd upplevelse')}</td>
              </tr>
              <tr>
                <th>Plats</th>
                <td>${get(booking, 'start_location.name', 'Okänd plats')}</td>
              </tr>
              <tr>
                <th>Datum & tid</th>
                <td>${getDateTimeDisplay(booking)}</td>
              </tr>
              <tr>
                <th>Tidslängd</th>
                <td>${getDurationText(get(booking, 'duration.duration_type'), get(booking, 'duration.duration_value'))}</td>
              </tr>
            </table>
          </div>

          <div class="section">
            <h2>Prisuppställning</h2>
            <table class="details-table">
              <thead>
                <tr>
                  <th>Typ</th>
                  <th style="text-align: center;">Antal</th>
                  <th style="text-align: right;">Pris (exkl. moms)</th>
                  <th style="text-align: right;">Moms (25%)</th>
                </tr>
              </thead>
              <tbody>
                ${bookingPriceGroupsHtml}
                ${bookingProductsHtml}
                ${bookingAddonsHtml}
                ${durationHtml}
              </tbody>
            </table>
            <table class="totals-table">
              <tr>
                <td class="label">Summa exkl. moms:</td>
                <td class="value">${formatPrice(totalPriceExcludingVat)}</td>
              </tr>
              <tr>
                <td class="label">Moms (25%):</td>
                <td class="value">${formatPrice(totalVatAmount)}</td>
              </tr>
              <tr>
                <td class="label">Totalt att betala:</td>
                <td class="value">${formatPrice(totalPriceIncludingVat)}</td>
              </tr>
            </table>
          </div>

          ${bookingGuaranteeHtml}
          ${commentHtml}

          <div class="section">
            <h2>Frågor?</h2>
            <p>Om du har några frågor om din bokning, svara på detta mail eller kontakta oss via <a href="mailto:info@stisses.se">info@stisses.se</a>.</p>
            <p>Vi ser fram emot att träffa dig!</p>
            <p>Hälsningar,<br>Stisses</p>
          </div>
        </div>
      </body>
    </html>
    `;
} 