<script lang="ts">
	import type { PageData } from './$types';
	import { format } from 'date-fns';
	import { sv } from 'date-fns/locale';

	// --- Configuration ---
	const VAT_RATE = 0.25; // 25% VAT

	// --- Props ---
	let { data } = $props<{ data: PageData }>();
	let bookings = /** @readonly */ $derived(data.bookings);
	let totalBookings = /** @readonly */ $derived(data.totalBookings);

	// --- Price Calculation Helpers ---
	function calculatePriceExcludingVat(totalIncludingVat: number): number {
		return totalIncludingVat / (1 + VAT_RATE);
	}

	function calculateVatAmount(totalIncludingVat: number): number {
		const priceExcludingVat = calculatePriceExcludingVat(totalIncludingVat);
		return totalIncludingVat - priceExcludingVat;
	}

	function formatPrice(amount: number): string {
		return new Intl.NumberFormat('sv-SE', {
			style: 'currency',
			currency: 'SEK',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(amount);
	}

	// --- Derived Values for Display ---
	let totalPriceIncludingVat = /** @readonly */ $derived(() =>
		bookings.reduce(
			(sum: number, booking: { total_price: number }) => sum + (booking.total_price || 0),
			0
		)
	);
	let totalPriceExcludingVat = /** @readonly */ $derived(() =>
		calculatePriceExcludingVat(totalPriceIncludingVat())
	);
	let totalVatAmount = /** @readonly */ $derived(() =>
		calculateVatAmount(totalPriceIncludingVat())
	);

	// --- Formatting Helpers ---
	function formatDateTime(date: string, time: string): string {
		try {
			const dateTime = new Date(`${date}T${time}`);
			return format(dateTime, 'EEEE d MMMM yyyy, HH:mm', { locale: sv });
		} catch (e) {
			console.error('Error formatting date/time:', date, time, e);
			return `${date} ${time}`;
		}
	}

	function getDurationText(
		type: string | null | undefined,
		value: number | null | undefined
	): string {
		if (!type || value === null || value === undefined) return 'Okänd längd';
		if (type === 'hours') {
			return value === 1 ? '1 timme' : `${value} timmar`;
		} else if (type === 'overnights') {
			return value === 1 ? '1 övernattning' : `${value} övernattningar`;
		}
		return 'Okänd längd';
	}
</script>

<svelte:head>
	<title>Bokningsbekräftelse - {bookings[0].booking_number}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="container mx-auto max-w-3xl px-4 py-8 print:p-0">
	<div
		class="space-y-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm sm:p-8 print:border-0 print:shadow-none"
	>
		<header class="border-b border-gray-200 pb-6 text-center">
			<h1 class="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
				Bokningsbekräftelse
			</h1>
			<p class="mt-2 text-base text-gray-500 sm:text-lg">
				Tack för din bokning, {bookings[0].first_name}!
			</p>
			<p class="mt-1 text-sm text-gray-500">
				mmer: <strong>{bookings[0].booking_number}</strong>
				{#if totalBookings > 1}
					<span class="ml-2">(och {totalBookings - 1} till)</span>
				{/if}
			</p>
		</header>

		{#each bookings as booking, i}
			<div class="space-y-6 {i > 0 ? 'border-t border-gray-200 pt-6' : ''}">
				{#if totalBookings > 1}
					<h2 class="text-xl font-semibold text-gray-800">Bokning {i + 1} av {totalBookings}</h2>
				{/if}

				<!-- Experience Details -->
				<section>
					<h3 class="mb-3 text-lg font-semibold text-gray-800">Aktivitet</h3>
					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<h4 class="text-sm font-medium text-gray-500">Namn</h4>
							<p class="text-base text-gray-900">{booking.experience?.name || 'Okänd aktivitet'}</p>
						</div>
						<div>
							<h4 class="text-sm font-medium text-gray-500">Startplats</h4>
							<p class="text-base text-gray-900">
								{booking.start_location?.name || 'Okänd startplats'}
							</p>
						</div>
						<div>
							<h4 class="text-sm font-medium text-gray-500">Längd</h4>
							<p class="text-base text-gray-900">
								{getDurationText(booking.duration?.duration_type, booking.duration?.duration_value)}
							</p>
						</div>
					</div>
				</section>

				<!-- Date and Time -->
				<section>
					<h3 class="mb-2 text-lg font-semibold text-gray-800">Datum & Tid</h3>
					<p class="text-base text-gray-900">
						Start: {formatDateTime(booking.start_date, booking.start_time)}
					</p>
					<p class="text-base text-gray-900">
						Slut: {formatDateTime(booking.end_date, booking.end_time)}
					</p>
				</section>

				<!-- Booking Items Breakdown -->
				<section class="space-y-4">
					<h3 class="text-lg font-semibold text-gray-800">Bokningsdetaljer</h3>

					<!-- Price Groups -->
					{#if booking.booking_price_groups?.length}
						<div class="flow-root">
							<h4 class="mb-1 text-sm font-medium text-gray-500">Antal personer</h4>
							<ul class="-my-2 divide-y divide-gray-200">
								{#each booking.booking_price_groups as group (group.price_groups.id)}
									<li class="flex py-2">
										<span class="flex-1 text-base text-gray-900"
											>{group.price_groups.display_name}</span
										>
										<span class="text-base text-gray-700">
											{group.quantity} × {formatPrice(group.price_at_time || 0)} exkl. moms
										</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					<!-- Products -->
					{#if booking.booking_products?.length}
						<div class="flow-root">
							<h4 class="mb-1 text-sm font-medium text-gray-500">Utrustning</h4>
							<ul class="-my-2 divide-y divide-gray-200">
								{#each booking.booking_products as product (product.products.id)}
									<li class="flex py-2">
										<span class="flex-1 text-base text-gray-900">{product.products.name}</span>
										<span class="text-base text-gray-700">
											{product.quantity} × {formatPrice(product.price_at_time || 0)} exkl. moms
										</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					<!-- Addons -->
					{#if booking.booking_addons?.length}
						<div class="flow-root">
							<h4 class="mb-1 text-sm font-medium text-gray-500">Tillägg</h4>
							<ul class="-my-2 divide-y divide-gray-200">
								{#each booking.booking_addons as addon (addon.addons.id)}
									<li class="flex py-2">
										<span class="flex-1 text-base text-gray-900">{addon.addons.name}</span>
										<span class="text-base text-gray-700">
											{addon.quantity} × {formatPrice(addon.price_at_time || 0)} exkl. moms
										</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					<!-- Individual Booking Total -->
					<div class="rounded-lg border bg-muted p-4">
						<p class="text-xl font-semibold">
							Pris för denna bokning: {formatPrice(booking.total_price)}
						</p>
					</div>
				</section>
			</div>
		{/each}

		<!-- Overall Totals -->
		<section class="mt-6 rounded-lg bg-gray-50 p-6">
			<h3 class="sr-only">Prisöversikt</h3>
			<div class="space-y-3">
				<div class="flex justify-between text-base text-gray-700">
					<span>Totalt (exkl. moms)</span>
					<span>{formatPrice(totalPriceExcludingVat())}</span>
				</div>
				<div class="flex justify-between text-base text-gray-700">
					<span>Moms ({VAT_RATE * 100}%)</span>
					<span>{formatPrice(totalVatAmount())}</span>
				</div>
				<div
					class="flex justify-between border-t border-gray-300 pt-3 text-base font-semibold text-gray-900"
				>
					<span>Totalt pris (inkl. moms)</span>
					<span>{formatPrice(totalPriceIncludingVat())}</span>
				</div>
				<div class="flex justify-between text-base font-semibold text-green-700">
					<span>Betalat</span>
					<span>{formatPrice(totalPriceIncludingVat())}</span>
				</div>
			</div>
		</section>

		<!-- Contact Information -->
		<section>
			<h3 class="mb-2 text-lg font-semibold text-gray-800">Kontaktuppgifter</h3>
			<div class="grid gap-1">
				<p class="text-base text-gray-900">{bookings[0].first_name} {bookings[0].last_name}</p>
				<p class="text-base text-gray-900">{bookings[0].email}</p>
				<p class="text-base text-gray-900">{bookings[0].phone}</p>
			</div>
		</section>

		<!-- Comment -->
		{#if bookings[0].comment}
			<section class="border-t border-gray-200 pt-6">
				<h3 class="mb-2 text-lg font-semibold text-gray-800">Meddelande från dig</h3>
				<p class="whitespace-pre-wrap text-base text-gray-700">{bookings[0].comment}</p>
			</section>
		{/if}

		<!-- Footer -->
		<footer class="mt-8 border-t border-gray-200 pt-6 text-center text-sm text-gray-500">
			<p>
				Spara denna bekräftelse. Vi har även skickat en kopia till din e-post ({bookings[0].email}).
			</p>
			<p class="mt-2">
				Vid frågor, kontakta oss på <a
					href="mailto:info@stisses.se"
					class="text-indigo-600 hover:underline">info@stisses.se</a
				>
				eller ring
				<a href="tel:+46703259638" class="text-indigo-600 hover:underline">+46703259638</a>.
			</p>
			<p class="mt-4 text-xs">
				Stisses Sport och Fritid AB | 559416-1308 | Reningsverksvägen 2, 26232 Ängelholm
			</p>
		</footer>
	</div>
</div>

<style>
	@media print {
		:global(body) {
			background: white !important;
		}
		.container {
			max-width: 100%;
		}
	}
</style>
