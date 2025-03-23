<script lang="ts">
	import { cn } from '$lib/utils';
	import { addVat, formatPrice } from '$lib/utils/price';

	interface PriceGroup {
		id: number;
		experience_id: number;
		start_location_id: number | null;
		internal_name: string;
		display_name: string;
		price: number;
	}

	let {
		priceGroups = [],
		startLocationId,
		onQuantityChange = () => {},
		isLocked = $bindable(false),
		onNextStep = $bindable(() => {}),
		includeVat = $bindable(true),
		extraPrice = $bindable(0)
	} = $props<{
		priceGroups: PriceGroup[];
		startLocationId: number;
		onQuantityChange: (quantities: Record<number, number>) => void;
		isLocked?: boolean;
		onNextStep?: () => void;
		includeVat?: boolean;
		extraPrice?: number;
	}>();

	let quantities = $state<Record<number, number>>({});

	// Calculate total paying customers (excluding free price groups)
	let totalPayingCustomers = $derived(
		Object.entries(quantities).reduce((sum, [groupId, quantity]) => {
			const group = priceGroups.find((g: PriceGroup) => g.id === parseInt(groupId));
			return group && group.price > 0 ? sum + quantity : sum;
		}, 0)
	);

	// Calculate total amount including extra price for paying customers
	let totalAmount = $derived(() => {
		// Calculate base price from price groups
		const baseTotal = Object.entries(quantities).reduce((sum, [groupId, quantity]) => {
			const group = priceGroups.find((g: PriceGroup) => g.id === parseInt(groupId));
			const basePrice = group ? group.price * quantity : 0;
			return sum + (includeVat ? addVat(basePrice) : basePrice);
		}, 0);

		// Calculate extra price only for paying customers
		const totalExtraPrice = extraPrice * totalPayingCustomers;

		console.log('Base total:', baseTotal);
		console.log('Total paying customers:', totalPayingCustomers);
		console.log('Extra price per person:', extraPrice);
		console.log('Total extra price:', totalExtraPrice);
		console.log(
			'Final total:',
			baseTotal + (includeVat ? addVat(totalExtraPrice) : totalExtraPrice)
		);

		return baseTotal + (includeVat ? addVat(totalExtraPrice) : totalExtraPrice);
	});

	$effect(() => {
		// Use startLocationId to make sure the effect tracks it
		if (startLocationId !== undefined) {
			// Reset quantities when startLocationId changes
			quantities = {};
			onQuantityChange({});
		}
	});

	function increment(groupId: number) {
		if (isLocked) return;
		quantities[groupId] = (quantities[groupId] || 0) + 1;
		onQuantityChange(quantities);
	}

	function decrement(groupId: number) {
		if (isLocked) return;
		if (quantities[groupId] > 0) {
			quantities[groupId] = quantities[groupId] - 1;
			onQuantityChange(quantities);
		}
	}

	function getDisplayPrice(price: number): string {
		const displayPrice = includeVat ? addVat(price) : price;
		return formatPrice(displayPrice);
	}
</script>

<div class="space-y-6">
	<div class="space-y-4">
		<h2 class="text-center text-2xl font-semibold">Antal personer</h2>
		<div class="mx-auto max-w-md space-y-4">
			{#each priceGroups.filter((group: PriceGroup) => group.start_location_id === startLocationId || group.start_location_id === null) as group (group.id)}
				<div
					class={cn(
						'flex items-center justify-between rounded-lg border p-4',
						isLocked && 'opacity-50'
					)}
				>
					<div>
						<p class="font-medium">{group.display_name}</p>
						<p class="text-sm text-muted-foreground">
							{getDisplayPrice(group.price)} per person
							{#if includeVat}
								<span class="text-xs">(inkl. moms)</span>
							{:else}
								<span class="text-xs">(exkl. moms)</span>
							{/if}
						</p>
					</div>
					<div class="flex items-center gap-4">
						<button
							type="button"
							class="rounded-md bg-primary/10 p-2 text-primary hover:bg-primary/20"
							onclick={() => decrement(group.id)}
							disabled={isLocked}
						>
							-
						</button>
						<span class="min-w-[2ch] text-center">{quantities[group.id] || 0}</span>
						<button
							type="button"
							class="rounded-md bg-primary/10 p-2 text-primary hover:bg-primary/20"
							onclick={() => increment(group.id)}
							disabled={isLocked}
						>
							+
						</button>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<div class="flex flex-col items-center gap-4">
		{#if totalAmount() > 0}
			<div class="text-center">
				{#if extraPrice > 0 && totalPayingCustomers > 0}
					<p class="mb-1 text-sm text-muted-foreground">
						Tillägg för vald längd: {formatPrice(
							includeVat
								? addVat(extraPrice * totalPayingCustomers)
								: extraPrice * totalPayingCustomers
						)}
						{#if includeVat}
							<span class="text-xs">(inkl. moms)</span>
						{:else}
							<span class="text-xs">(exkl. moms)</span>
						{/if}
					</p>
				{/if}
				<p class="text-lg font-medium">
					Totalt: {formatPrice(totalAmount())}
					{#if includeVat}
						<span class="text-sm text-muted-foreground">(inkl. moms)</span>
					{:else}
						<span class="text-sm text-muted-foreground">(exkl. moms)</span>
					{/if}
				</p>
			</div>
		{/if}
		<button
			class="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
			onclick={onNextStep}
			disabled={totalAmount() === 0 || isLocked}
		>
			Nästa steg
		</button>
	</div>
</div>
