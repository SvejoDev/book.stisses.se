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

	let {
		startLocationId,
		selectedDuration = $bindable(''),
		onDurationSelect = (duration: { type: string; value: number }) => {}
	} = $props();

	let durations = $state<Duration[]>([]);
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
		const selected = durations.find((d) => d.id.toString() === selectedDuration);
		displayText = selected
			? `${selected.duration_value} ${getDurationTypeText(selected.duration_type, selected.duration_value)}`
			: 'Välj längd på bokning';

		if (selected) {
			onDurationSelect({
				type: selected.duration_type,
				value: selected.duration_value
			});
		}
	});

	function handleValueChange(value: string) {
		selectedDuration = value;
	}

	function getDurationTypeText(type: string, value: number): string {
		if (type === 'hours') {
			return value === 1 ? 'timme' : 'timmar';
		} else if (type === 'overnights') {
			return value === 1 ? 'övernattning' : 'övernattningar';
		}
		return type;
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
					{getDurationTypeText(duration.duration_type, duration.duration_value)}
					{#if duration.extra_price > 0}
						(+{duration.extra_price} kr)
					{/if}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
</div>

<input type="hidden" name="duration" value={selectedDuration} />
