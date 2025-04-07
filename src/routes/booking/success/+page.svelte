<script lang="ts">
	import type { PageData } from './$types';
	import { formatPrice } from '$lib/utils/price';

	let { data } = $props<{ data: PageData }>();
	let booking = $derived(data.booking);
</script>

<div class="container mx-auto max-w-3xl px-4 py-8">
	<div class="space-y-8">
		<header class="text-center">
			<h1 class="text-4xl font-bold">Bokningsbekräftelse</h1>
			<p class="mt-2 text-muted-foreground">Bokningsnummer: {booking.booking_number}</p>
		</header>

		<div class="space-y-4 rounded-lg border p-6">
			<h2 class="text-2xl font-semibold">Bokningsinformation</h2>

			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<h3 class="font-medium">Kontaktuppgifter</h3>
					<p>{booking.first_name} {booking.last_name}</p>
					<p>{booking.email}</p>
					<p>{booking.phone}</p>
				</div>

				<div>
					<h3 class="font-medium">Tidpunkt</h3>
					<p>Datum: {new Date(booking.start_date).toLocaleDateString()}</p>
					<p>Tid: {booking.start_time} - {booking.end_time}</p>
				</div>
			</div>

			<!-- Price Groups -->
			{#if booking.booking_price_groups?.length}
				<div>
					<h3 class="font-medium">Antal personer</h3>
					<ul class="mt-2 space-y-2">
						{#each booking.booking_price_groups as group}
							<li class="flex justify-between">
								<span>{group.price_groups.display_name}</span>
								<span>{group.quantity} st</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<!-- Products -->
			{#if booking.booking_products?.length}
				<div>
					<h3 class="font-medium">Utrustning</h3>
					<ul class="mt-2 space-y-2">
						{#each booking.booking_products as product}
							<li class="flex justify-between">
								<span>{product.products.name}</span>
								<span>{product.quantity} st</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<!-- Addons -->
			{#if booking.booking_addons?.length}
				<div>
					<h3 class="font-medium">Tillägg</h3>
					<ul class="mt-2 space-y-2">
						{#each booking.booking_addons as addon}
							<li class="flex justify-between">
								<span>{addon.addons.name}</span>
								<span>{addon.quantity} st</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<div class="border-t pt-4">
				<div class="flex justify-between text-lg font-semibold">
					<span>Totalt</span>
					<span>{formatPrice(booking.total_price)} kr</span>
				</div>
			</div>
		</div>
	</div>
</div>
