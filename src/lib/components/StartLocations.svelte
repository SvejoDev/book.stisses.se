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

<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
	{#each startLocations as location}
		<div
			role="button"
			tabindex={0}
			onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && handleSelect(location.id.toString())}
			onclick={() => handleSelect(location.id.toString())}
		>
			<Card.Root
				class={cn(
					'cursor-pointer transition-all hover:scale-105',
					value === location.id.toString() && 'ring-2 ring-primary'
				)}
			>
				<Card.Header>
					<img
						src={location.imageUrl}
						alt={location.name}
						class="h-48 w-full rounded-t-lg object-cover"
					/>
				</Card.Header>
				<Card.Content class="pt-4">
					<h3 class="mb-2 text-lg font-semibold">{location.name}</h3>
					<p class="text-sm text-muted-foreground">
						Pris per person: {location.price_per_person} kr
					</p>
					<!-- Add a short description here when available in the StartLocation interface -->
				</Card.Content>
			</Card.Root>
		</div>
	{/each}
</div>

<input type="hidden" name="startLocation" {value} />
