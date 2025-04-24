<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import { cn } from '$lib/utils';
	import { getDisplayPrice, formatPrice } from '$lib/utils/price';

	interface Duration {
		id: number;
		start_location_id: number;
		duration_type: string;
		duration_value: number;
		extra_price: number;
	}

	let {
		startLocationId,
		experienceId,
		selectedDuration = $bindable(''),
		durations = $bindable<Duration[]>([]),
		isLoading = $bindable(false),
		isLocked = $bindable(false),
		onDurationSelect = () => {},
		extraPrice = $bindable(0),
		experienceType = $bindable<'private' | 'company' | 'school'>('private')
	} = $props<{
		startLocationId: string;
		experienceId: string;
		selectedDuration?: string;
		durations?: Duration[];
		isLoading?: boolean;
		isLocked?: boolean;
		onDurationSelect?: (duration: { type: string; value: number; extraPrice: number }) => void;
		experienceType?: 'private' | 'company' | 'school';
	}>();

	let displayText = $state('Välj längd på bokning');

	async function fetchDurations(locationId: string) {
		try {
			isLoading = true;
			const response = await fetch(
				`/api/durations?startLocationId=${locationId}&experienceId=${experienceId}`
			);
			if (!response.ok) throw new Error('Failed to fetch durations');
			durations = await response.json();

			// Add a small delay if there's only one duration for better UX
			if (durations.length === 1) {
				await new Promise((resolve) => setTimeout(resolve, 500));
				// Auto-select if there's only one duration
				handleValueChange(durations[0].id.toString());
			} else {
				// Reset selection when changing to a location with multiple durations
				selectedDuration = '';
			}
		} catch (error) {
			console.error('Error fetching durations:', error);
			durations = [];
		} finally {
			isLoading = false;
		}
	}

	$effect(() => {
		if (startLocationId) {
			fetchDurations(startLocationId);
		}
	});

	$effect(() => {
		const selected = durations.find((d: Duration) => d.id.toString() === selectedDuration);
		displayText = selected
			? `${selected.duration_value} ${getDurationTypeText(selected.duration_type, selected.duration_value)}`
			: 'Välj längd på bokning';

		if (selected) {
			extraPrice = selected.extra_price;
			onDurationSelect({
				type: selected.duration_type,
				value: selected.duration_value,
				extraPrice: selected.extra_price
			});
		}
	});

	function handleValueChange(value: string) {
		if (isLocked) return;
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

	// Format price with correct VAT handling
	function getFormattedPrice(price: number): string {
		return formatPrice(getDisplayPrice(price, experienceType));
	}
</script>

<div class="w-full max-w-xs">
	{#if isLoading}
		<div
			class="flex h-10 w-full items-center justify-center rounded-md border border-input bg-background px-3"
		>
			<span class="text-sm text-muted-foreground">Laddar...</span>
		</div>
	{:else}
		<Select.Root
			type="single"
			onValueChange={handleValueChange}
			value={selectedDuration}
			disabled={isLocked}
		>
			<Select.Trigger class={cn(isLocked && 'cursor-not-allowed opacity-50')}>
				<span>{displayText}</span>
			</Select.Trigger>
			<Select.Content>
				{#each durations as duration}
					<Select.Item value={duration.id.toString()}>
						{duration.duration_value}
						{getDurationTypeText(duration.duration_type, duration.duration_value)}
						{#if duration.extra_price > 0}
							(+{getFormattedPrice(duration.extra_price)}
							{#if experienceType === 'private'}
								<span class="left ml-1">inkl. moms</span>
							{:else}
								<span class="ml-1 text-xs">exkl. moms</span>
							{/if})
						{/if}
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{/if}
</div>

<input type="hidden" name="duration" value={selectedDuration} />
