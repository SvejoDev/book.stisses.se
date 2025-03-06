<script lang="ts">
	import PrivateBooking from '$lib/components/booking/PrivateBooking.svelte';
	import SchoolBooking from '$lib/components/booking/SchoolBooking.svelte';
	import CompanyBooking from '$lib/components/booking/CompanyBooking.svelte';

	interface Experience {
		id: string;
		type: 'private' | 'school' | 'company';
		name: string;
	}

	interface StartLocation {
		id: number;
		experience_id: number;
		name: string;
		price_per_person: number;
	}

	let { data } = $props<{
		experience: Experience;
		startLocations: StartLocation[];
	}>();
	console.log(data);
</script>

<svelte:head>
	<title>{data.experience.name}</title>
</svelte:head>

{#if data.experience.type === 'private'}
	<PrivateBooking experience={data.experience} startLocations={data.startLocations} />
{:else if data.experience.type === 'school'}
	<SchoolBooking experience={data.experience} />
{:else if data.experience.type === 'company'}
	<CompanyBooking experience={data.experience} />
{:else}
	<p>Invalid experience type</p>
{/if}
