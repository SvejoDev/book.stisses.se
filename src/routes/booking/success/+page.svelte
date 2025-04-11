<script lang="ts">
	import type { PageData } from './$types';
	import { formatPrice, calculateVatAmount, isVatExempt } from '$lib/utils/price';
	import { format } from 'date-fns';
	import { sv } from 'date-fns/locale';

	let { data } = $props<{ data: PageData }>();
	let booking = $derived(data.booking);

	function formatDateTime(date: string, time: string): string {
		const dateTime = new Date(`${date}T${time}`);
		return format(dateTime, 'EEEE d MMMM yyyy, HH:mm', { locale: sv });
	}

	function getDurationText(type: string, value: number): string {
		if (type === 'hours') {
			return value === 1 ? '1 timme' : `${value} timmar`;
		} else if (type === 'overnights') {
			return value === 1 ? '1 övernattning' : `${value} övernattningar`;
		}
		return '';
	}

	// Calculate subtotals
	let priceGroupTotal = $derived(() => {
		return booking.booking_price_groups.reduce(
			(sum: number, group: { price_at_time: number; quantity: number }) => {
				return sum + (group.price_at_time || 0) * group.quantity;
			},
			0
		);
	});

	let productTotal = $derived(() => {
		return booking.booking_products.reduce(
			(sum: number, product: { price_at_time: number; quantity: number }) => {
				return sum + (product.price_at_time || 0) * product.quantity;
			},
			0
		);
	});

	let addonTotal = $derived(() => {
		return booking.booking_addons.reduce(
			(sum: number, addon: { price_at_time: number; quantity: number }) => {
				return sum + (addon.price_at_time || 0) * addon.quantity;
			},
			0
		);
	});

	let durationTotal = $derived(() => {
		const payingCustomers = booking.booking_price_groups.reduce(
			(sum: number, group: { quantity: number }) => sum + group.quantity,
			0
		);
		return (booking.duration?.extra_price || 0) * payingCustomers;
	});

	let total = $derived(() => priceGroupTotal() + productTotal() + addonTotal() + durationTotal());

	let vatAmount = $derived(() =>
		calculateVatAmount(total(), booking.experience?.type || 'private')
	);

	let displayTotal = $derived(() => total() + vatAmount());

	let showVat = $derived(() => !isVatExempt(booking.experience?.type || 'private'));
</script>

<svelte:head>
	<title>Bokningsbekräftelse - {booking.booking_number}</title>
</svelte:head>

<div class="container mx-auto max-w-3xl px-4 py-8 print:p-0">
	<div
		class="space-y-8 rounded-lg border border-gray-200 bg-white p-8 shadow-sm print:border-0 print:shadow-none"
	>
		<header class="border-b pb-6">
			<div class="text-center">
				<h1 class="text-3xl font-bold tracking-tight">Bokningsbekräftelse</h1>
				<p class="mt-2 text-lg text-muted-foreground">Bokningsnummer: {booking.booking_number}</p>
			</div>
		</header>

		<div class="grid gap-6">
			<!-- Experience Details -->
			<section>
				<h2 class="mb-4 text-xl font-semibold">{booking.experience?.name}</h2>
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<h3 class="font-medium text-gray-600">Startplats</h3>
						<p>{booking.start_location?.name}</p>
					</div>
					<div>
						<h3 class="font-medium text-gray-600">Längd</h3>
						<p>
							{getDurationText(booking.duration?.duration_type, booking.duration?.duration_value)}
						</p>
					</div>
				</div>
			</section>

			<!-- Date and Time -->
			<section>
				<h3 class="mb-2 font-medium text-gray-600">Tidpunkt</h3>
				<p>Start: {formatDateTime(booking.start_date, booking.start_time)}</p>
				<p>Slut: {formatDateTime(booking.end_date, booking.end_time)}</p>
			</section>

			<!-- Contact Information -->
			<section>
				<h3 class="mb-2 font-medium text-gray-600">Kontaktuppgifter</h3>
				<div class="grid gap-2">
					<p>{booking.first_name} {booking.last_name}</p>
					<p>{booking.email}</p>
					<p>{booking.phone}</p>
				</div>
			</section>

			<!-- Booking Details -->
			<section class="space-y-4">
				<!-- Price Groups -->
				{#if booking.booking_price_groups?.length}
					<div>
						<h3 class="mb-2 font-medium text-gray-600">Antal personer</h3>
						<div class="space-y-1">
							{#each booking.booking_price_groups as group}
								<div class="flex justify-between text-sm">
									<span>{group.price_groups.display_name}</span>
									<span>
										{group.quantity} × {group.price_at_time
											? `${formatPrice(group.price_at_time)}`
											: 'Ingår'}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Products -->
				{#if booking.booking_products?.length}
					<div>
						<h3 class="mb-2 font-medium text-gray-600">Utrustning</h3>
						<div class="space-y-1">
							{#each booking.booking_products as product}
								<div class="flex justify-between text-sm">
									<span>{product.products.name}</span>
									<span>
										{product.quantity} × {product.price_at_time
											? `${formatPrice(product.price_at_time)}`
											: 'Ingår'}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Addons -->
				{#if booking.booking_addons?.length}
					<div>
						<h3 class="mb-2 font-medium text-gray-600">Tillägg</h3>
						<div class="space-y-1">
							{#each booking.booking_addons as addon}
								<div class="flex justify-between text-sm">
									<span>{addon.addons.name}</span>
									<span>
										{addon.quantity} × {addon.price_at_time
											? `${formatPrice(addon.price_at_time)}`
											: 'Ingår'}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</section>

			<!-- Totals -->
			<section class="mt-6 rounded-lg bg-gray-50 p-6">
				<div class="space-y-3">
					<div class="flex flex-col gap-2">
						<div class="flex justify-between">
							<span>Totalt (exkl. moms)</span>
							<span>{formatPrice(total())}</span>
						</div>
						<div class="flex justify-between">
							<span>Moms</span>
							<span>{showVat() ? formatPrice(vatAmount()) : '0,00'} kr</span>
						</div>
						<div class="flex justify-between">
							<span>Totalt pris</span>
							<span>{formatPrice(displayTotal())}</span>
						</div>
						<div class="flex justify-between border-t pt-2">
							<span class="font-semibold">Betalat</span>
							<span class="font-semibold">{formatPrice(displayTotal())}</span>
						</div>
					</div>
				</div>
			</section>

			{#if booking.comment}
				<section class="border-t pt-4">
					<h3 class="mb-2 font-medium text-gray-600">Meddelande</h3>
					<p class="text-sm">{booking.comment}</p>
				</section>
			{/if}
		</div>

		<!-- Footer -->
		<footer class="mt-8 border-t pt-6 text-center text-sm text-gray-500">
			<p>Tack för din bokning! Spara denna bekräftelse.</p>
			<p class="mt-2">Vid frågor, kontakta oss på info@stisses.se</p>
		</footer>
	</div>
</div>

<style>
	@media print {
		:global(body) {
			background: white !important;
		}
	}
</style>
