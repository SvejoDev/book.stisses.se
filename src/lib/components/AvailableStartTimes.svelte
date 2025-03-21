<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import type { AvailableTime } from '$lib/types';

	let {
		experienceId,
		selectedDate,
		durationType,
		durationValue,
		selectedProducts = []
	} = $props<{
		experienceId: number;
		selectedDate: Date;
		durationType: 'hours' | 'overnights';
		durationValue: number;
		selectedProducts: Array<{ productId: number; quantity: number }>;
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
	let availableTimes = $state<AvailableTime[]>([]);
	let error = $state<string | null>(null);

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
			error = null;

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
		} catch (e) {
			console.error('Error in generateStartTimes:', e);
			error = e instanceof Error ? e.message : 'An error occurred';
		} finally {
			isLoading = false;
			console.log('=== generateStartTimes END ===');
		}
	}
</script>

<div class="space-y-4">
	<button
		class="h-10 w-full rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
		onclick={generateStartTimes}
		disabled={isLoading}
	>
		{#if isLoading}
			Genererar starttider...
		{:else}
			Generera starttider
		{/if}
	</button>

	{#if error}
		<p class="text-sm text-destructive">{error}</p>
	{/if}

	{#if availableTimes.length > 0}
		<div class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
			{#each availableTimes as time}
				<button
					class="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
					onclick={() => console.log('Selected time:', time)}
				>
					{time.startTime}
				</button>
			{/each}
		</div>
	{:else if !isLoading && !error}
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
