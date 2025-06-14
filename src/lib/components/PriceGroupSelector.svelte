<script lang="ts">
	import { cn } from '$lib/utils';
	import { formatPrice, getDisplayPrice } from '$lib/utils/price';
	import type { PriceGroup } from '$lib/types/price';

	let {
		priceGroups = $bindable<PriceGroup[]>([]),
		startLocationId,
		experienceId,
		onQuantityChange = () => {},
		isLocked = $bindable(false),
		onNextStep = $bindable(() => {}),
		includeVat = $bindable(true),
		extraPrice = $bindable(0),
		pricingType = $bindable('per_person'),
		experienceType = $bindable<string>('private'),
		isLoading = $bindable(false),
		initialQuantities = {}
	} = $props<{
		priceGroups?: PriceGroup[];
		startLocationId: number | string;
		experienceId: string;
		onQuantityChange: (quantities: Record<number, number>) => void;
		isLocked?: boolean;
		onNextStep?: () => void;
		includeVat?: boolean;
		extraPrice?: number;
		pricingType: 'per_person' | 'per_product' | 'hybrid';
		experienceType: string;
		isLoading?: boolean;
		initialQuantities?: Record<number, number>;
	}>();

	let quantities = $state<Record<number, number>>({});
	let lastInitializedQuantities = $state('');
	let lastStartLocationId = $state<number | string | null>(null);
	let isFetching = $state(false);

	// Calculate total paying customers (excluding free price groups)
	let totalPayingCustomers = /** @readonly */ $derived(
		Object.entries(quantities).reduce((sum, [groupId, quantity]) => {
			const group = priceGroups.find((g: PriceGroup) => g.id === parseInt(groupId));
			return group && group.is_payable ? sum + quantity : sum;
		}, 0)
	);

	// Calculate total non-paying customers
	let totalNonPayingCustomers = /** @readonly */ $derived(
		Object.entries(quantities).reduce((sum, [groupId, quantity]) => {
			const group = priceGroups.find((g: PriceGroup) => g.id === parseInt(groupId));
			return group && !group.is_payable ? sum + quantity : sum;
		}, 0)
	);

	// Calculate total amount EXCLUDING extra price and VAT
	let calculatedBaseTotalExclVat = /** @readonly */ $derived(() => {
		if (pricingType === 'per_product') return 0;

		return Object.entries(quantities).reduce((sum, [groupId, quantity]) => {
			const group = priceGroups.find((g: PriceGroup) => g.id === parseInt(groupId));
			if (!group || !group.is_payable) return sum;
			return sum + group.price * quantity;
		}, 0);
	});

	async function fetchPriceGroups(locationId: number | string) {
		// Prevent concurrent fetches
		if (isFetching) {
			return;
		}

		try {
			isFetching = true;
			isLoading = true;
			const response = await fetch(
				`/api/price-groups?startLocationId=${locationId}&experienceId=${experienceId}`
			);
			if (!response.ok) throw new Error('Failed to fetch price groups');

			const newPriceGroups = await response.json();
			priceGroups = newPriceGroups;

			// Only reset quantities when price groups change if not locked AND no initial quantities
			if (!isLocked && Object.keys(initialQuantities).length === 0) {
				quantities = {};
				onQuantityChange({});
			}
		} catch (error) {
			console.error('Error fetching price groups:', error);
			priceGroups = [];
			if (!isLocked && Object.keys(initialQuantities).length === 0) {
				quantities = {};
				onQuantityChange({});
			}
		} finally {
			isLoading = false;
			isFetching = false;
		}
	}

	// Fetch price groups when startLocationId or experienceId changes
	// Use $effect.pre to run before DOM updates and be more specific about dependencies
	$effect.pre(() => {
		// Only track the specific values that should trigger a fetch
		const currentLocationId = startLocationId;
		const currentExperienceId = experienceId;

		if (currentLocationId !== undefined && currentExperienceId && !isFetching) {
			// Only reset initialization tracking if the location actually changed or we don't have initial quantities
			const locationChanged =
				lastStartLocationId !== null && lastStartLocationId !== currentLocationId;
			const hasInitialQuantities = Object.keys(initialQuantities).length > 0;

			// Only fetch if the location actually changed or this is the first time
			if (lastStartLocationId !== currentLocationId) {
				if (locationChanged && !hasInitialQuantities) {
					lastInitializedQuantities = '';
				}

				lastStartLocationId = currentLocationId;
				fetchPriceGroups(currentLocationId);
			}
		}
	});

	// Initialize quantities from initialQuantities when provided
	$effect(() => {
		const currentInitialQuantities = JSON.stringify(initialQuantities);

		if (
			Object.keys(initialQuantities).length > 0 &&
			priceGroups.length > 0 &&
			lastInitializedQuantities !== currentInitialQuantities
		) {
			quantities = { ...initialQuantities };
			lastInitializedQuantities = currentInitialQuantities;
			// Don't call onQuantityChange here to prevent circular updates during initialization
			// The parent already has these quantities in initialQuantities
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
		{#if isLoading}
			<div class="mx-auto max-w-md">
				<div class="flex h-20 items-center justify-center rounded-lg border">
					<span class="text-sm text-muted-foreground">Laddar priser...</span>
				</div>
			</div>
		{:else}
			<div class="mx-auto max-w-md space-y-4">
				{#each priceGroups as group (group.id)}
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
		{/if}
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
			disabled={totalPayingCustomers + totalNonPayingCustomers === 0 || isLocked || isLoading}
		>
			Nästa steg
		</button>
	</div>
</div>
