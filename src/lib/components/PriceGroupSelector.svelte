<script lang="ts">
	import { cn } from '$lib/utils';
	import { getBothPrices, formatPrice, getDisplayPrice } from '$lib/utils/price';

	interface PriceGroup {
		id: number;
		experience_id: number;
		start_location_id: number | null;
		internal_name: string;
		display_name: string;
		price: number;
		is_payable: boolean;
	}

	let {
		priceGroups = [],
		startLocationId,
		onQuantityChange = () => {},
		isLocked = $bindable(false),
		onNextStep = $bindable(() => {}),
		includeVat = $bindable(true),
		extraPrice = $bindable(0),
		pricingType = $bindable('per_person'),
		experienceType = $bindable<string>('private')
	} = $props<{
		priceGroups: PriceGroup[];
		startLocationId: number;
		onQuantityChange: (quantities: Record<number, number>) => void;
		isLocked?: boolean;
		onNextStep?: () => void;
		includeVat?: boolean;
		extraPrice?: number;
		pricingType: 'per_person' | 'per_product' | 'hybrid';
		experienceType: string;
	}>();

	let quantities = $state<Record<number, number>>({});

	// Filter price groups based on start location or no location requirement
	let filteredPriceGroups = $derived(
		priceGroups.filter(
			(group: PriceGroup) =>
				group.start_location_id === startLocationId || group.start_location_id === null
		)
	);

	// Calculate total paying customers (excluding free price groups)
	let totalPayingCustomers = $derived(
		Object.entries(quantities).reduce((sum, [groupId, quantity]) => {
			const group = priceGroups.find((g: PriceGroup) => g.id === parseInt(groupId));
			return group && group.is_payable ? sum + quantity : sum;
		}, 0)
	);

	// Calculate total non-paying customers
	let totalNonPayingCustomers = $derived(
		Object.entries(quantities).reduce((sum, [groupId, quantity]) => {
			const group = priceGroups.find((g: PriceGroup) => g.id === parseInt(groupId));
			return group && !group.is_payable ? sum + quantity : sum;
		}, 0)
	);

	// Calculate total amount EXCLUDING extra price and VAT
	let calculatedBaseTotalExclVat = $derived(() => {
		if (pricingType === 'per_product') return 0;

		// Calculate base price from price groups using group.price (excl. VAT)
		const baseTotal = Object.entries(quantities).reduce((sum, [groupId, quantity]) => {
			const group = priceGroups.find((g: PriceGroup) => g.id === parseInt(groupId));
			if (!group || !group.is_payable) return sum;

			// Use group.price which is always excl. VAT for the calculation
			return sum + group.price * quantity;
		}, 0);

		console.log('Price Groups base cost (calculated excl. VAT):', baseTotal);
		return baseTotal;
	});

	$effect(() => {
		if (startLocationId !== undefined) {
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

	// Use getDisplayPrice for consistent price display
	function getFormattedPrice(price: number): string {
		return formatPrice(getDisplayPrice(price, experienceType));
	}

	// Export methods for parent components
	export function totalAmount(): number {
		return calculatedBaseTotalExclVat();
	}

	export function getPayingCustomers(): number {
		return totalPayingCustomers;
	}

	export function getNonPayingCustomers(): number {
		return totalNonPayingCustomers;
	}
</script>

<div class="space-y-6">
	<div class="space-y-4">
		<h2 class="text-center text-2xl font-semibold">Antal personer</h2>
		<div class="mx-auto max-w-md space-y-4">
			{#each filteredPriceGroups as group (group.id)}
				<div
					class={cn(
						'flex items-center justify-between rounded-lg border p-4',
						isLocked && 'opacity-50'
					)}
				>
					<div>
						<p class="font-medium">{group.display_name}</p>
						{#if pricingType !== 'per_product' && group.is_payable}
							<p class="text-sm text-muted-foreground">
								{getFormattedPrice(group.price)} per person
								{#if experienceType === 'private'}
									<span class="text-xs">(inkl. moms)</span>
								{:else}
									<span class="text-xs">(exkl. moms)</span>
								{/if}
							</p>
						{/if}
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
		{#if pricingType !== 'per_product' && calculatedBaseTotalExclVat() > 0}
			<div class="text-center">
				{#if extraPrice > 0 && totalPayingCustomers > 0}
					<p class="mb-1 text-sm text-muted-foreground">
						Tillägg för vald längd: {formatPrice(
							getDisplayPrice(extraPrice * totalPayingCustomers, experienceType)
						)}
					</p>
				{/if}
				<p class="text-lg font-medium">
					Totalt: {formatPrice(
						getDisplayPrice(
							calculatedBaseTotalExclVat() + extraPrice * totalPayingCustomers,
							experienceType
						)
					)}
					{#if experienceType === 'private'}
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
			disabled={totalPayingCustomers + totalNonPayingCustomers === 0 || isLocked}
		>
			Nästa steg
		</button>
	</div>
</div>
