<script lang="ts">
	import StartLocations from '$lib/components/StartLocations.svelte';
	import BookingDurations from '$lib/components/BookingDurations.svelte';
	import Calendar from '$lib/components/Calendar.svelte';

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

	interface OpenDate {
		id: number;
		experience_id: number;
		type: 'interval' | 'specific';
		start_date: string | null;
		end_date: string | null;
		specific_date: string | null;
		created_at: string;
	}

	interface BlockedDate {
		id: number;
		experience_id: number;
		start_date: string;
		end_date: string;
		reason: string | null;
		created_at: string;
	}

	let {
		experience,
		startLocations,
		openDates = [],
		blockedDates = []
	} = $props<{
		experience: Experience;
		startLocations: StartLocation[];
		openDates: OpenDate[];
		blockedDates: BlockedDate[];
	}>();

	let selectedStartLocation = $state('');
	let selectedDuration = $state('');
	let durationType = $state('');
	let durationValue = $state(0);
	let durationsSection = $state<HTMLElement | null>(null);
	let calendarSection = $state<HTMLElement | null>(null);
	let durations = $state<any[]>([]);
	let isLoadingDurations = $state(false);

	let isSingleLocation = $derived(startLocations.length === 1);
	let shouldShowDurations = $derived(isSingleLocation || selectedStartLocation !== '');

	function handleStartLocationSelect(locationId: string) {
		selectedStartLocation = locationId;
		if (!isSingleLocation) {
			durationsSection?.scrollIntoView({ behavior: 'smooth' });
		}
	}

	function handleDurationSelect(duration: { type: string; value: number }) {
		durationType = duration.type;
		durationValue = duration.value;
		calendarSection?.scrollIntoView({ behavior: 'smooth' });
	}

	function getStartLocationHeading() {
		return startLocations.length === 1 ? 'Din startplats' : 'Välj en startplats';
	}

	function getDurationHeading() {
		return durations.length === 1 ? 'Din bokningslängd' : 'Välj längd på bokning';
	}
</script>

<div class="space-y-8">
	<header class="text-center">
		<h1 class="text-4xl font-bold tracking-tight">{experience.name}</h1>
	</header>

	<section class="space-y-4">
		<h2 class="text-center text-2xl font-semibold">{getStartLocationHeading()}</h2>
		<StartLocations {startLocations} onSelect={handleStartLocationSelect} />
	</section>

	{#if shouldShowDurations}
		<section class="space-y-4" bind:this={durationsSection}>
			<h2 class="text-center text-2xl font-semibold">{getDurationHeading()}</h2>
			<div class="flex justify-center">
				<BookingDurations
					startLocationId={selectedStartLocation}
					bind:selectedDuration
					bind:durations
					bind:isLoading={isLoadingDurations}
					onDurationSelect={handleDurationSelect}
				/>
			</div>
		</section>

		{#if selectedDuration}
			<section class="space-y-4" bind:this={calendarSection}>
				<h2 class="text-center text-2xl font-semibold">Välj startdatum</h2>
				<div class="flex justify-center">
					<Calendar {selectedDuration} {durationType} {durationValue} {openDates} {blockedDates} />
				</div>
			</section>
		{/if}
	{/if}
</div>
