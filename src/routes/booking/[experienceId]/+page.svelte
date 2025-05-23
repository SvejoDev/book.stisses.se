<script lang="ts">
	import Booking from '$lib/components/booking/Booking.svelte';
	import type { PageData } from './$types';

	let { data } = $props<{ data: PageData }>();
</script>

<svelte:head>
	<title>{data.experience.name}</title>
</svelte:head>

<div class="container mx-auto max-w-7xl px-4 py-8">
	<Booking
		experience={data.experience}
		startLocations={data.startLocations}
		openDates={data.openDates}
		blockedDates={data.blockedDates}
		priceGroups={data.priceGroups}
		pricingType={data.experience.pricing_type}
	/>
</div>
