<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { cn } from '$lib/utils';
	import type { StartLocation } from '$lib/types/experience';

	let {
		startLocations,
		onSelect,
		isLocked = $bindable(false),
		reset = $bindable(false),
		selectedValue = $bindable('')
	} = $props<{
		startLocations: StartLocation[];
		onSelect: (locationId: string) => void;
		isLocked?: boolean;
		reset?: boolean;
		selectedValue?: string;
	}>();
	let value = $state('');
	let isSingleLocation = $derived(startLocations.length === 1);

	// Sync internal value with selectedValue prop when provided
	$effect(() => {
		if (selectedValue !== undefined && selectedValue !== value && selectedValue !== '') {
			value = selectedValue;
		}
	});

	// Reset value when reset prop changes
	$effect(() => {
		if (reset) {
			value = '';
			// Only update selectedValue if it's different to avoid loops
			if (selectedValue !== '') {
				selectedValue = '';
			}
		}
	});

	// Preload images
	$effect(() => {
		startLocations.forEach((location: StartLocation) => {
			if (location.imageUrl) {
				const img = new Image();
				img.src = location.imageUrl;
			}
		});
	});

	// Auto-select if there's only one start location
	$effect(() => {
		if (startLocations.length === 1 && !value && !isLocked) {
			handleSelect(startLocations[0].id.toString());
		}
	});

	// Call onSelect when value changes (but only if it's not empty and not caused by reset)
	$effect(() => {
		if (value && !reset) {
			onSelect(value);
		}
	});

	function handleSelect(locationId: string) {
		if (isLocked) {
			return;
		}

		value = locationId;
		selectedValue = locationId;

		// Add a small delay before calling onSelect to allow the page to settle
		setTimeout(() => {
			onSelect(locationId);
		}, 300);
	}
</script>

<div class="grid w-full place-items-center">
	<div class="grid w-full grid-cols-[repeat(auto-fit,minmax(0,320px))] justify-center gap-6">
		{#each startLocations as location}
			{#if isSingleLocation}
				<div>
					<Card.Root
						class={cn('h-full w-full', value === location.id.toString() && 'ring-1 ring-muted')}
					>
						<Card.Header class="p-0">
							<img
								src={location.imageUrl}
								alt={location.name}
								class="aspect-[4/3] w-full rounded-t-lg object-cover"
								loading="eager"
								fetchpriority="high"
							/>
						</Card.Header>
						<Card.Content class="p-6">
							<h3 class="text-xl font-semibold">{location.name}</h3>
						</Card.Content>
					</Card.Root>
				</div>
			{:else}
				<button
					type="button"
					class="text-left"
					onclick={() => handleSelect(location.id.toString())}
					disabled={isLocked}
				>
					<Card.Root
						class={cn(
							'h-full w-full transition-all hover:scale-[1.02] hover:shadow-lg',
							value === location.id.toString() && 'ring-2 ring-primary',
							isLocked && 'cursor-not-allowed opacity-50'
						)}
					>
						<Card.Header class="p-0">
							<img
								src={location.imageUrl}
								alt={location.name}
								class="aspect-[4/3] w-full rounded-t-lg object-cover"
								loading="eager"
								fetchpriority="high"
							/>
						</Card.Header>
						<Card.Content class="p-6">
							<h3 class="text-xl font-semibold">{location.name}</h3>
						</Card.Content>
					</Card.Root>
				</button>
			{/if}
		{/each}
	</div>
</div>

<input type="hidden" name="startLocation" {value} />
