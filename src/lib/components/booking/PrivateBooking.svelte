<script lang="ts">
	import StartLocations from '$lib/components/StartLocations.svelte';

	interface Experience {
		id: string;
		type: 'private';
		name: string;
	}

	interface StartLocation {
		id: number;
		experience_id: number;
		name: string;
		price_per_person: number;
	}

	let { experience, startLocations } = $props<{
		experience: Experience;
		startLocations: StartLocation[];
	}>();
</script>

<h2>{experience.name}</h2>

<div class="mt-4">
	<h3 class="mb-2 text-lg font-semibold">Choose your start location</h3>
	<StartLocations {startLocations} />
</div>
