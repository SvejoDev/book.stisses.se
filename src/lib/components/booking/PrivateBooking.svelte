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

<div class="space-y-8">
	<header class="text-center">
		<h1 class="text-4xl font-bold tracking-tight">{experience.name}</h1>
	</header>

	<section class="space-y-4">
		<h2 class="text-2xl font-semibold text-center">Välj en startplats</h2>
		<StartLocations {startLocations} />
	</section>
</div>
