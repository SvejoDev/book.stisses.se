<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';
	import * as Select from '$lib/components/ui/select';
	import { cn } from '$lib/utils';

	interface Duration {
		id: number;
		start_location_id: number;
		duration_type: string;
		duration_value: number;
		extra_price: number;
	}

	let { startLocationId } = $props<{ startLocationId: string }>();
	let durations = $state<Duration[]>([]);
	let selectedDuration = $state('');
	let displayText = $state('Välj längd på bokning');

	async function fetchDurations(locationId: string) {
		try {
			const response = await fetch(`/api/durations?startLocationId=${locationId}`);
			if (!response.ok) throw new Error('Failed to fetch durations');
			durations = await response.json();
		} catch (error) {
			console.error('Error fetching durations:', error);
			durations = [];
		}
	}

	$effect(() => {
		if (startLocationId) {
			fetchDurations(startLocationId);
		}
	});

	$effect(() => {
		console.log('Selected duration:', selectedDuration);
		const selected = durations.find((d) => d.id.toString() === selectedDuration);
		displayText = selected
			? `${selected.duration_value} ${selected.duration_type}`
			: 'Välj längd på bokning';
	});

	function handleValueChange(value: string) {
		selectedDuration = value;
	}
</script>

<div class="w-full max-w-xs">
	<Select.Root type="single" onValueChange={handleValueChange} value={selectedDuration}>
		<Select.Trigger>
			<span>{displayText}</span>
		</Select.Trigger>
		<Select.Content>
			{#each durations as duration}
				<Select.Item value={duration.id.toString()}>
					{duration.duration_value}
					{duration.duration_type}
					{#if duration.extra_price > 0}
						(+{duration.extra_price} kr)
					{/if}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
</div>

<input type="hidden" name="duration" value={selectedDuration} />
