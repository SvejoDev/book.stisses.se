<script lang="ts">
	import StartLocations from '$lib/components/StartLocations.svelte';
	import PriceGroupSelector from '$lib/components/PriceGroupSelector.svelte';

	interface Experience {
		id: string;
		type: 'school';
		name: string;
	}

	interface StartLocation {
		id: number;
		experience_id: number;
		name: string;
		price_per_person: number;
	}

	interface PriceGroup {
		id: number;
		experience_id: number;
		start_location_id: number | null;
		internal_name: string;
		display_name: string;
		price: number;
	}

	let {
		experience,
		startLocations = [],
		priceGroups = []
	} = $props<{
		experience: Experience;
		startLocations: StartLocation[];
		priceGroups: PriceGroup[];
	}>();

	let selectedLocationId = $state<number | null>(null);
	let priceGroupQuantities = $state<Record<number, number>>({});
	let showDurations = $state(false);

	function handleLocationSelect(locationId: string) {
		const newLocationId = parseInt(locationId);
		if (selectedLocationId !== newLocationId) {
			selectedLocationId = newLocationId;
			priceGroupQuantities = {};
			showDurations = false;
		}
	}

	function handlePriceGroupQuantityChange(quantities: Record<number, number>) {
		priceGroupQuantities = quantities;
	}

	function handleNextStep() {
		showDurations = true;
	}

	function getStartLocationHeading() {
		return startLocations.length === 1 ? 'Din startplats' : 'Välj en startplats';
	}
</script>

<div class="space-y-8">
	<header class="text-center">
		<h1 class="text-4xl font-bold tracking-tight">{experience.name}</h1>
	</header>

	<section class="space-y-4">
		<h2 class="text-center text-2xl font-semibold">{getStartLocationHeading()}</h2>
		<StartLocations {startLocations} onSelect={handleLocationSelect} />
	</section>

	{#if selectedLocationId !== null}
		<section class="space-y-4">
			<PriceGroupSelector
				{priceGroups}
				startLocationId={selectedLocationId}
				onQuantityChange={handlePriceGroupQuantityChange}
				onNextStep={handleNextStep}
				includeVat={false}
			/>
		</section>
	{/if}
</div>
