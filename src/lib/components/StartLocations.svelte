<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { cn } from '$lib/utils';

	interface StartLocation {
		id: number;
		experience_id: number;
		name: string;
		price_per_person: number;
		imageUrl: string;
	}

	let {
		startLocations,
		onSelect,
		isLocked = $bindable(false)
	} = $props<{
		startLocations: StartLocation[];
		onSelect: (locationId: string) => void;
		isLocked?: boolean;
	}>();
	let value = $state('');
	let isSingleLocation = $derived(startLocations.length === 1);

	// Preload images
	$effect(() => {
		startLocations.forEach((location: StartLocation) => {
			const img = new Image();
			img.src = location.imageUrl;
		});
	});

	$effect(() => {
		// Auto-select if there's only one start location
		if (isSingleLocation && !value) {
			handleSelect(startLocations[0].id.toString());
		}
	});

	$effect(() => {
		if (value) {
			onSelect(value);
		}
	});

	function handleSelect(locationId: string) {
		if (isLocked) return;
		value = locationId;
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
							<h3 class="mb-2 text-xl font-semibold">{location.name}</h3>
							<p class="text-base text-muted-foreground">
								Pris per person: {location.price_per_person} kr
							</p>
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
							<h3 class="mb-2 text-xl font-semibold">{location.name}</h3>
							<p class="text-base text-muted-foreground">
								Pris per person: {location.price_per_person} kr
							</p>
						</Card.Content>
					</Card.Root>
				</button>
			{/if}
		{/each}
	</div>
</div>

<input type="hidden" name="startLocation" {value} />
