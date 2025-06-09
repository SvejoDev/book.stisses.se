<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import { cn } from '$lib/utils';
	import { getDisplayPrice, formatPrice } from '$lib/utils/price';
	import type { Duration } from '$lib/types/experience';

	let {
		startLocationId,
		experienceId,
		selectedDuration = $bindable(''),
		durations = $bindable<Duration[]>([]),
		isLoading = $bindable(false),
		isLocked = $bindable(false),
		onDurationSelect = () => {},
		extraPrice = $bindable(0),
		experienceType = $bindable<'private' | 'company' | 'school'>('private'),
		initialSelectedDuration = ''
	} = $props<{
		startLocationId: string;
		experienceId: string;
		selectedDuration?: string;
		durations?: Duration[];
		isLoading?: boolean;
		isLocked?: boolean;
		onDurationSelect?: (duration: { type: string; value: number; extraPrice: number }) => void;
		experienceType?: 'private' | 'company' | 'school';
		initialSelectedDuration?: string;
	}>();

	let displayText = $state('Välj längd på bokning');
	let hasInitialized = $state(false);

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
				// Auto-select if there's only one duration (only if not locked)
				if (!isLocked) {
					handleValueChange(durations[0].id.toString());
				}
			} else {
				// Reset selection when changing to a location with multiple durations (only if not locked)
				if (!isLocked) {
					selectedDuration = '';
				}
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
			hasInitialized = false; // Reset initialization flag when location changes
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

	// Initialize selectedDuration from initialSelectedDuration when provided
	$effect(() => {
		if (initialSelectedDuration && durations.length > 0 && !hasInitialized) {
			selectedDuration = initialSelectedDuration;
			hasInitialized = true;
			// Also trigger the duration select callback to ensure parent gets the duration details
			const selected = durations.find((d: Duration) => d.id.toString() === initialSelectedDuration);
			if (selected) {
				extraPrice = selected.extra_price;
				onDurationSelect({
					type: selected.duration_type,
					value: selected.duration_value,
					extraPrice: selected.extra_price
				});
			}
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
