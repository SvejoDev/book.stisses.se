<script lang="ts">
	import StartLocations from '$lib/components/StartLocations.svelte';
	import BookingDurations from '$lib/components/BookingDurations.svelte';
	import Calendar from './Calendar.svelte';

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

	let selectedStartLocation = $state('');
	let selectedDuration = $state('');
	let durationType = $state('');
	let durationValue = $state(0);
	let durationsSection = $state<HTMLElement | null>(null);

	function handleStartLocationSelect(locationId: string) {
		selectedStartLocation = locationId;
		setTimeout(() => {
			durationsSection?.scrollIntoView({ behavior: 'smooth' });
		}, 100);
	}

	function handleDurationSelect(duration: { type: string; value: number }) {
		durationType = duration.type;
		durationValue = duration.value;
	}

	// Example blocked dates - replace with your actual data
	const blockedDates = [
		{
			start: new Date(2024, 3, 1), // April 1, 2024
			end: new Date(2024, 3, 5) // April 5, 2024
		}
	];
</script>

<div class="space-y-8">
	<header class="text-center">
		<h1 class="text-4xl font-bold tracking-tight">{experience.name}</h1>
	</header>

	<section class="space-y-4">
		<h2 class="text-center text-2xl font-semibold">Välj en startplats</h2>
		<StartLocations {startLocations} onSelect={handleStartLocationSelect} />
	</section>

	{#if selectedStartLocation}
		<section class="space-y-4" bind:this={durationsSection}>
			<h2 class="text-center text-2xl font-semibold">Välj längd på bokning</h2>
			<div class="flex justify-center">
				<BookingDurations
					startLocationId={selectedStartLocation}
					bind:selectedDuration
					onDurationSelect={handleDurationSelect}
				/>
			</div>
		</section>

		{#if selectedDuration}
			<section class="space-y-4">
				<h2 class="text-center text-2xl font-semibold">Välj startdatum</h2>
				<div class="flex justify-center">
					<Calendar {selectedDuration} {durationType} {durationValue} {blockedDates} />
				</div>
			</section>
		{/if}
	{/if}
</div>
