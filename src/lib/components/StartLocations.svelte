<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';

	interface StartLocation {
		id: number;
		experience_id: number;
		name: string;
		price_per_person: number;
	}

	let { startLocations } = $props<{ startLocations: StartLocation[] }>();

	let value = $state('');

	const triggerContent = $derived(
		startLocations.find((loc: StartLocation) => loc.id.toString() === value)?.name ??
			'Välj en startplats'
	);

	$effect(() => {
		console.log('Selected start location ID:', value);
	});
</script>

<Select.Root type="single" name="startLocation" bind:value>
	<Select.Trigger class="w-[280px]">
		{triggerContent}
	</Select.Trigger>
	<Select.Content>
		<Select.Group>
			{#each startLocations as location}
				<Select.Item value={location.id.toString()} label={location.name}>
					{location.name}
				</Select.Item>
			{/each}
		</Select.Group>
	</Select.Content>
</Select.Root>
