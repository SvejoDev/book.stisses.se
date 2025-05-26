<script lang="ts">
	import type { AvailableTime } from '$lib/types/availability';
	import type { SelectedStartTime } from '$lib/types/availability';
	import { cn } from '$lib/utils';
	import { addHours, addDays } from 'date-fns';

	let {
		experienceId,
		selectedDate,
		durationType,
		durationValue,
		selectedProducts = [],
		selectedAddons = [],
		onLockStateChange = () => {},
		onStartTimeSelect = () => {},
		showButton = true,
		initialSelectedStartTime = null,
		isLocked = false
	} = $props<{
		experienceId: number;
		selectedDate: Date;
		durationType: string;
		durationValue: number;
		selectedProducts: Array<{ productId: number; quantity: number }>;
		selectedAddons?: Array<{ addonId: number; quantity: number }>;
		onLockStateChange?: (locked: boolean) => void;
		onStartTimeSelect?: (time: { startTime: string; endTime: string }) => void;
		showButton?: boolean;
		initialSelectedStartTime?: { startTime: string; endTime: string } | null;
		isLocked?: boolean;
	}>();

	let isLoading = $state(false);
	let hasAttemptedLoad = $state(false);
	let availableTimes = $state<AvailableTime[]>([]);
	let error = $state<string | null>(null);
	let selectedTime = $state<AvailableTime | null>(null);
	let hasInitialized = $state(false);

	let totalProductQuantity = /** @readonly */ $derived(
		selectedProducts.reduce(
			(sum: number, product: { quantity: number }) => sum + product.quantity,
			0
		)
	);
	let canGenerateTimes = /** @readonly */ $derived(totalProductQuantity > 0);

	// Filter times to show only 30-minute intervals
	let displayTimes = /** @readonly */ $derived(
		availableTimes.filter((time) => {
			const [hours, minutes] = time.startTime.split(':').map(Number);
			return minutes % 30 === 0;
		})
	);

	// Monitor addons state changes
	$effect(() => {
		if (selectedAddons?.length > 0) {
		}
	});

	// Auto-load times and set selected time when restoring a previous booking
	$effect(() => {
		if (initialSelectedStartTime && !hasInitialized && canGenerateTimes) {
			hasInitialized = true;
			hasAttemptedLoad = true;
			generateStartTimes().then(() => {
				// After times are loaded, find and set the matching selected time
				const matchingTime = availableTimes.find(
					(time) => time.startTime === initialSelectedStartTime.startTime
				);
				if (matchingTime) {
					selectedTime = matchingTime;
				}
			});
		}
	});

	$effect(() => {
		if (selectedTime) {
			const [hours, minutes] = selectedTime.startTime.split(':').map(Number);
			const startDateTime = new Date(selectedDate);
			startDateTime.setHours(hours, minutes, 0, 0);

			let endDateTime;
			if (durationType === 'hours') {
				endDateTime = addHours(startDateTime, durationValue);
			} else {
				// For overnight bookings, end time is the closing time of the last day
				endDateTime = addDays(startDateTime, durationValue);
				const [endHours, endMinutes] = selectedTime.endTime.split(':').map(Number);
				endDateTime.setHours(endHours, endMinutes, 0, 0);
			}

			// Call onStartTimeSelect with the selected time
			onStartTimeSelect(selectedTime);
		}
	});

	function scrollToBottom() {
		setTimeout(() => {
			window.scrollTo({
				top: document.documentElement.scrollHeight,
				behavior: 'smooth'
			});
		}, 100);
	}

	async function generateStartTimes() {
		try {
			isLoading = true;
			hasAttemptedLoad = true;
			error = null;
			onLockStateChange(true);

			const requestData = {
				date: selectedDate.toISOString().split('T')[0],
				durationType,
				durationValue,
				products: $state.snapshot(selectedProducts),
				addons: $state.snapshot(selectedAddons) || [],
				experienceId
			};

			const response = await fetch('/api/check-availability', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(requestData)
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error('Error response:', errorText);
				throw new Error(`Failed to fetch available times: ${errorText}`);
			}

			const data = await response.json();
			availableTimes = data.availableTimes;

			// Scroll to bottom after times are loaded
			if (data.availableTimes.length > 0) {
				scrollToBottom();
			} else {
				// Also scroll when no times are available
				scrollToBottom();
			}
		} catch (e) {
			console.error('Error in generateStartTimes:', e);
			error = e instanceof Error ? e.message : 'An error occurred';
			onLockStateChange(true);
		} finally {
			isLoading = false;
		}
	}

	function handleTimeSelect(time: AvailableTime) {
		selectedTime = time;
		// onStartTimeSelect will be called by the $effect tracking selectedTime
	}

	function handleReset() {
		hasAttemptedLoad = false;
		availableTimes = [];
		error = null;
		selectedTime = null;
		onLockStateChange(false);
	}
</script>

<div class="space-y-4">
	{#if !hasAttemptedLoad && showButton}
		<button
			class="h-10 w-full rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
			onclick={generateStartTimes}
			disabled={isLoading || !canGenerateTimes}
		>
			{#if isLoading}
				Laddar...
			{:else if !canGenerateTimes}
				Välj minst en produkt
			{:else}
				Nästa steg
			{/if}
		</button>
	{:else if hasAttemptedLoad && showButton}
		<button
			class="h-10 w-full rounded-md border border-primary bg-background px-4 py-2 text-primary hover:bg-primary/10"
			onclick={handleReset}
		>
			Ändra din bokning
		</button>
	{/if}

	{#if error && hasAttemptedLoad}
		<p class="text-sm text-destructive">{error}</p>
	{/if}

	{#if availableTimes.length > 0}
		<div class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
			{#each displayTimes as time}
				<button
					class={cn(
						'inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
						selectedTime === time && 'bg-primary text-primary-foreground hover:bg-primary/90'
					)}
					onclick={() => handleTimeSelect(time)}
				>
					{time.startTime}
				</button>
			{/each}
		</div>
	{:else if !isLoading && !error && hasAttemptedLoad}
		<div class="space-y-2 text-center">
			<p class="font-medium text-destructive">Inga tillgängliga tider hittades</p>
			<p class="text-sm text-muted-foreground">Vänligen prova att:</p>
			<ul class="list-inside list-disc text-sm text-muted-foreground">
				<li>Välja ett annat datum</li>
				<li>Ändra antalet produkter</li>
				<li>Justera bokningslängden</li>
			</ul>
		</div>
	{/if}
</div>

<style>
	button {
		transition: all 0.2s ease-in-out;
	}

	button:hover {
		transform: scale(1.02);
	}
</style>
