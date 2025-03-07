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

	let { startLocations } = $props<{ startLocations: StartLocation[] }>();
	let value = $state('');

	$effect(() => {
		console.log('Selected start location ID:', value);
	});

	function handleSelect(locationId: string) {
		value = locationId;
	}
</script>

<div class="grid w-full place-items-center">
	<div class="grid w-full grid-cols-[repeat(auto-fit,minmax(0,320px))] justify-center gap-6">
		{#each startLocations as location}
			<div
				role="button"
				tabindex={0}
				onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && handleSelect(location.id.toString())}
				onclick={() => handleSelect(location.id.toString())}
			>
				<Card.Root
					class={cn(
						'h-full w-full cursor-pointer transition-all hover:scale-[1.02] hover:shadow-lg',
						value === location.id.toString() && 'ring-2 ring-primary'
					)}
				>
					<Card.Header class="p-0">
						<img
							src={location.imageUrl}
							alt={location.name}
							class="aspect-[4/3] w-full rounded-t-lg object-cover"
						/>
					</Card.Header>
					<Card.Content class="p-6">
						<h3 class="mb-2 text-xl font-semibold">{location.name}</h3>
						<p class="text-base text-muted-foreground">
							Pris per person: {location.price_per_person} kr
						</p>
						<!-- Add a short description here when available in the StartLocation interface -->
					</Card.Content>
				</Card.Root>
			</div>
		{/each}
	</div>
</div>

<input type="hidden" name="startLocation" {value} />
