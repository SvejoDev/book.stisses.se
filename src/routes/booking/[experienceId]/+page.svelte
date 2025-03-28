<script lang="ts">
	import PrivateBooking from '$lib/components/booking/PrivateBooking.svelte';
	import SchoolBooking from '$lib/components/booking/SchoolBooking.svelte';
	import CompanyBooking from '$lib/components/booking/CompanyBooking.svelte';
	import type { PageData } from './$types';

	let { data } = $props<{ data: PageData }>();
</script>

<svelte:head>
	<title>{data.experience.name}</title>
</svelte:head>

<div class="container mx-auto max-w-7xl px-4 py-8">
	{#if data.experience.type === 'private'}
		<PrivateBooking
			experience={data.experience}
			startLocations={data.startLocations}
			openDates={data.openDates}
			blockedDates={data.blockedDates}
			priceGroups={data.experience.pricing_type !== 'per_product' ? data.priceGroups : []}
			pricingType={data.experience.pricing_type}
		/>
	{:else if data.experience.type === 'school'}
		<SchoolBooking
			experience={data.experience}
			startLocations={data.startLocations}
			priceGroups={data.priceGroups}
			openDates={data.openDates}
			blockedDates={data.blockedDates}
		/>
	{:else if data.experience.type === 'company'}
		<CompanyBooking experience={data.experience} />
	{:else}
		<p>Invalid experience type</p>
	{/if}
</div>
