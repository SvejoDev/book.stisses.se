<script lang="ts">
	import PrivateBooking from '$lib/components/booking/PrivateBooking.svelte';
	import SchoolBooking from '$lib/components/booking/SchoolBooking.svelte';
	import CompanyBooking from '$lib/components/booking/CompanyBooking.svelte';
	import type { PageData } from './$types';

	let { data } = $props<{ data: PageData }>();

	let privateBookingRef = $state<{ getTotalPrice: () => number } | null>(null);

	// Log total price whenever it changes
	$effect(() => {
		if (data.experience.type === 'private' && privateBookingRef) {
			console.log('=== TOTAL BOOKING COST ===');
			console.log('Total cost:', privateBookingRef.getTotalPrice());
			console.log('========================');
		}
	});
</script>

<svelte:head>
	<title>{data.experience.name}</title>
</svelte:head>

<div class="container mx-auto max-w-7xl px-4 py-8">
	{#if data.experience.type === 'private'}
		<PrivateBooking
			bind:this={privateBookingRef}
			experience={data.experience}
			startLocations={data.startLocations}
			openDates={data.openDates}
			blockedDates={data.blockedDates}
			priceGroups={data.priceGroups}
			pricingType={data.experience.pricing_type}
		/>
	{:else if data.experience.type === 'school'}
		<SchoolBooking
			experience={data.experience}
			startLocations={data.startLocations}
			priceGroups={data.priceGroups}
			openDates={data.openDates}
			blockedDates={data.blockedDates}
			pricingType={data.experience.pricing_type}
		/>
	{:else if data.experience.type === 'company'}
		<CompanyBooking experience={data.experience} />
	{:else}
		<p>Invalid experience type</p>
	{/if}
</div>
