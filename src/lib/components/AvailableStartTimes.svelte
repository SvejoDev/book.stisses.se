<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import type { AvailableTime } from '$lib/types';
	import { cn } from '$lib/utils';
	import { addHours, addDays, format } from 'date-fns';

	let {
		experienceId,
		selectedDate,
		durationType,
		durationValue,
		selectedProducts = [],
		onLockStateChange = (locked: boolean) => {}
	} = $props<{
		experienceId: number;
		selectedDate: Date;
		durationType: 'hours' | 'overnights';
		durationValue: number;
		selectedProducts: Array<{ productId: number; quantity: number }>;
		onLockStateChange?: (locked: boolean) => void;
	}>();

	$effect(() => {
		console.log('Props received:', {
			experienceId,
			selectedDate,
			durationType,
			durationValue,
			selectedProducts
		});
	});

	let isLoading = $state(false);
	let hasAttemptedLoad = $state(false);
	let availableTimes = $state<AvailableTime[]>([]);
	let error = $state<string | null>(null);
	let isLocked = $state(false);
	let selectedTime = $state<AvailableTime | null>(null);

	let totalProductQuantity = $derived(
		selectedProducts.reduce(
			(sum: number, product: { quantity: number }) => sum + product.quantity,
			0
		)
	);
	let canGenerateTimes = $derived(totalProductQuantity > 0);

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

			$inspect(
				{
					selectedTime,
					startDateTime: format(startDateTime, 'yyyy-MM-dd HH:mm'),
					endDateTime: format(endDateTime, 'yyyy-MM-dd HH:mm'),
					durationType,
					durationValue
				},
				'Booking details'
			);
		}
	});

	async function generateStartTimes() {
		console.log('=== generateStartTimes START ===');
		console.log('Function called with props:', {
			experienceId,
			selectedDate,
			durationType,
			durationValue,
			selectedProducts
		});

		try {
			isLoading = true;
			hasAttemptedLoad = true;
			error = null;
			isLocked = true;
			onLockStateChange(true);

			const requestData = {
				date: selectedDate.toISOString().split('T')[0],
				durationType,
				durationValue,
				products: selectedProducts,
				experienceId
			};

			console.log('Sending request with data:', requestData);
			console.log('Sending to URL:', '/api/check-availability');

			const response = await fetch('/api/check-availability', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(requestData)
			});

			console.log('Response received:', {
				status: response.status,
				statusText: response.statusText,
				ok: response.ok
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error('Error response:', errorText);
				throw new Error(`Failed to fetch available times: ${errorText}`);
			}

			const data = await response.json();
			console.log('Response data:', data);
			availableTimes = data.availableTimes;

			// Scroll to bottom after times are loaded
			if (data.availableTimes.length > 0) {
				setTimeout(() => {
					window.scrollTo({
						top: document.documentElement.scrollHeight,
						behavior: 'smooth'
					});
				}, 100); // Small delay to ensure DOM is updated
			}
		} catch (e) {
			console.error('Error in generateStartTimes:', e);
			error = e instanceof Error ? e.message : 'An error occurred';
			isLocked = true;
			onLockStateChange(true);
		} finally {
			isLoading = false;
			console.log('=== generateStartTimes END ===');
		}
	}

	function handleTimeSelect(time: AvailableTime) {
		selectedTime = time;
	}

	function handleReset() {
		isLocked = false;
		hasAttemptedLoad = false;
		availableTimes = [];
		error = null;
		selectedTime = null;
		onLockStateChange(false);
	}
</script>

<div class="space-y-4">
	{#if !hasAttemptedLoad}
		<button
			class="h-10 w-full rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
			onclick={generateStartTimes}
			disabled={isLoading || !canGenerateTimes}
		>
			{#if isLoading}
				Genererar starttider...
			{:else if !canGenerateTimes}
				Välj minst en produkt för att generera starttider
			{:else}
				Generera starttider
			{/if}
		</button>
	{:else}
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
			{#each availableTimes as time}
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
