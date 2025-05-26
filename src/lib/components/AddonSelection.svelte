<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { cn } from '$lib/utils';
	import { formatPrice, getDisplayPrice } from '$lib/utils/price';
	import type { SelectedAddon } from '$lib/types/addon';
	import type { Addon } from '$lib/types/addon';

	let {
		startLocationId = $bindable(''),
		experienceId = $bindable(''),
		selectedProducts = [],
		isLocked = $bindable(false),
		onAddonsSelected = (addons: SelectedAddon[]) => {},
		onAddonsLoaded = () => {},
		pricingType = $bindable<'per_person' | 'per_product' | 'hybrid'>('per_person'),
		payingCustomers = $bindable(0),
		onAddonsFetched = () => {},
		includeVat = $bindable(true),
		experienceType = $bindable<string>('private'),
		initialSelectedAddons = [],
		autoFetch = $bindable(false)
	} = $props<{
		startLocationId: string;
		experienceId: string;
		selectedProducts: Array<{ productId: number; quantity: number }>;
		isLocked?: boolean;
		onAddonsSelected?: (addons: SelectedAddon[]) => void;
		onAddonsLoaded?: () => void;
		pricingType?: 'per_person' | 'per_product' | 'hybrid';
		payingCustomers?: number;
		onAddonsFetched?: () => void;
		includeVat?: boolean;
		experienceType: string;
		initialSelectedAddons?: SelectedAddon[];
		autoFetch?: boolean;
	}>();

	let selectedQuantities = $state<Record<number, number>>({});
	let selectedPerPersonAddons = $state<Record<number, boolean>>({});
	let allImagesLoaded = $state(false);
	let initialLoadDone = $state(false);
	let isLoading = $state(false);
	let addons = $state<Addon[]>([]);
	let error = $state<string | null>(null);
	let hasAttemptedFetch = $state(false);
	let lastInitializedAddons = $state<string>('');

	// Initialize selected addons from initialSelectedAddons - prevent infinite loops
	$effect(() => {
		if (initialSelectedAddons.length > 0) {
			const initialAddonsKey = JSON.stringify(initialSelectedAddons);
			// Only initialize if we haven't already initialized with these exact addons
			if (lastInitializedAddons !== initialAddonsKey) {
				const quantities: Record<number, number> = {};
				const perPersonAddons: Record<number, boolean> = {};

				initialSelectedAddons.forEach((addon: SelectedAddon) => {
					// Check if this is a per-person addon by looking at the quantity vs payingCustomers
					if (addon.quantity === payingCustomers && payingCustomers > 0) {
						perPersonAddons[addon.addonId] = true;
					} else {
						quantities[addon.addonId] = addon.quantity;
					}
				});

				selectedQuantities = quantities;
				selectedPerPersonAddons = perPersonAddons;
				lastInitializedAddons = initialAddonsKey;
			}
		} else if (lastInitializedAddons !== '') {
			// Reset quantities if no initial addons and we had some before
			selectedQuantities = {};
			selectedPerPersonAddons = {};
			lastInitializedAddons = '';
		}
	});

	// Auto-fetch addons when autoFetch is true
	$effect(() => {
		if (
			autoFetch &&
			!hasAttemptedFetch &&
			selectedProducts.length > 0 &&
			selectedProducts.some((p: { quantity: number }) => p.quantity > 0)
		) {
			fetchAddons();
		}
	});

	async function fetchAddons() {
		try {
			isLoading = true;
			error = null;
			hasAttemptedFetch = true;

			// Create URL with productIds as repeated query parameters
			const url = new URL('/api/addons', window.location.origin);
			url.searchParams.set('startLocationId', startLocationId);
			url.searchParams.set('experienceId', experienceId);
			url.searchParams.set('pricingType', pricingType);

			// Add each productId as a separate productIds[] parameter
			selectedProducts
				.filter((p: { productId: number; quantity: number }) => p.quantity > 0)
				.forEach((product: { productId: number; quantity: number }) => {
					url.searchParams.append('productIds[]', product.productId.toString());
				});

			const response = await fetch(url);

			if (!response.ok) {
				throw new Error('Failed to fetch addons');
			}

			addons = await response.json();

			// Add a small delay if there are no addons for better UX
			if (addons.length === 0) {
				await new Promise((resolve) => setTimeout(resolve, 500));
			}

			onAddonsFetched();
		} catch (e) {
			error = e instanceof Error ? e.message : 'An error occurred';
		} finally {
			isLoading = false;
		}
	}

	// Handle image loading once when addons change
	$effect(() => {
		if (addons.length > 0 && !initialLoadDone) {
			initialLoadDone = true;
			// Only load images that actually have a URL
			const unloadedImages = addons.filter((addon) => addon.imageUrl);

			if (unloadedImages.length === 0) {
				allImagesLoaded = true;
				onAddonsLoaded();
				return;
			}

			Promise.all(
				unloadedImages.map(
					(addon) =>
						new Promise<void>((resolve) => {
							// addons without imageUrl resolve immediately
							if (!addon.imageUrl) {
								resolve();
								return;
							}
							const img = new Image();
							img.onload = () => resolve();
							img.onerror = () => resolve(); // avoid hanging on broken URLs
							img.src = addon.imageUrl;
						})
				)
			).then(() => {
				allImagesLoaded = true;
				onAddonsLoaded();
			});
		}
	});

	function incrementAddon(addonId: number) {
		if (isLocked) return;
		const currentQuantity = selectedQuantities[addonId] || 0;
		const addon = addons.find((a) => a.id === addonId);

		if (
			addon &&
			typeof addon.total_quantity === 'number' &&
			currentQuantity < addon.total_quantity
		) {
			selectedQuantities[addonId] = currentQuantity + 1;
		}
	}

	function decrementAddon(addonId: number) {
		if (isLocked) return;
		const currentQuantity = selectedQuantities[addonId] || 0;

		if (currentQuantity > 0) {
			selectedQuantities[addonId] = currentQuantity - 1;
		}
	}

	function togglePerPersonAddon(addonId: number) {
		if (isLocked) return;
		selectedPerPersonAddons[addonId] = !selectedPerPersonAddons[addonId];
	}

	// Notify parent of quantity changes
	$effect(() => {
		const selectedAddons = [
			...Object.entries(selectedQuantities)
				.filter(([_, quantity]) => quantity > 0)
				.map(([addonId, quantity]) => ({
					addonId: parseInt(addonId),
					quantity,
					price: addons.find((a) => a.id === parseInt(addonId))?.price
				})),
			...Object.entries(selectedPerPersonAddons)
				.filter(([_, selected]) => selected)
				.map(([addonId]) => ({
					addonId: parseInt(addonId),
					quantity: payingCustomers,
					price: addons.find((a) => a.id === parseInt(addonId))?.price
				}))
		];

		onAddonsSelected(selectedAddons as SelectedAddon[]);
	});

	function handleFetchAddons() {
		fetchAddons();
	}
</script>

<div class="mx-auto max-w-3xl">
	{#if !hasAttemptedFetch}
		<div class="my-4 flex justify-center">
			<Button
				variant="default"
				size="lg"
				onclick={handleFetchAddons}
				disabled={selectedProducts.length === 0 ||
					selectedProducts.every((p: { quantity: number }) => p.quantity === 0)}
			>
				Se tillgängliga tillägg
			</Button>
		</div>
	{:else if isLoading}
		<div class="flex h-24 items-center justify-center">
			<div
				class="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent"
			></div>
		</div>
	{:else if error}
		<div class="text-center text-destructive">
			<p>{error}</p>
		</div>
	{:else if addons.length === 0}
		<div class="my-4 text-center text-muted-foreground">
			<p>Inga tillägg tillgängliga för din valda utrustning.</p>
		</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2">
			{#each addons as addon, index (addon.id)}
				<Card class="flex h-full flex-col">
					<CardHeader class="flex flex-row gap-4">
						<div class="relative h-24 w-24 flex-shrink-0">
							{#if addon.imageUrl}
								<img
									src={addon.imageUrl}
									alt={addon.name}
									class="absolute h-full w-full rounded-lg object-cover transition-opacity duration-300"
									style="opacity: {allImagesLoaded ? '1' : '0'}"
									loading={index < 2 ? 'eager' : 'lazy'}
									fetchpriority={index < 2 ? 'high' : 'auto'}
								/>
								{#if !allImagesLoaded}
									<div class="absolute h-full w-full animate-pulse rounded-lg bg-muted">
										<div class="flex h-full items-center justify-center">
											<div
												class="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent"
											></div>
										</div>
									</div>
								{/if}
							{:else}
								<div
									class="absolute flex h-full w-full items-center justify-center rounded-lg bg-muted"
								>
									<svg
										class="h-12 w-12 text-muted-foreground"
										xmlns="http://www.w3.org/2000/svg"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
										/>
									</svg>
								</div>
							{/if}
						</div>
						<div class="flex-grow">
							<CardTitle>{addon.name}</CardTitle>
							<CardDescription>{addon.description}</CardDescription>
							<p class="mt-1 text-sm text-muted-foreground">
								{#if addon.price === 0 || addon.price === undefined}
									Ingår
								{:else}
									{formatPrice(getDisplayPrice(addon.price ?? 0, experienceType))}
									{#if addon.pricing_type === 'per_person'}
										per person
									{:else}
										per enhet
									{/if}
									{#if experienceType === 'private'}
										<span class="text-xs">(inkl. moms)</span>
									{:else}
										<span class="text-xs">(exkl. moms)</span>
									{/if}
								{/if}
							</p>
						</div>
					</CardHeader>
					<CardContent class="mt-auto">
						<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
							{#if addon.pricing_type === 'per_unit'}
								<div class="flex items-center gap-4">
									<Button
										variant="outline"
										size="icon"
										onclick={() => decrementAddon(addon.id)}
										disabled={!selectedQuantities[addon.id] || isLocked}
										class={cn(isLocked && 'cursor-not-allowed opacity-50')}
									>
										-
									</Button>
									<span class="w-8 text-center">{selectedQuantities[addon.id] || 0}</span>
									<Button
										variant="outline"
										size="icon"
										onclick={() => incrementAddon(addon.id)}
										disabled={typeof addon.total_quantity !== 'number' ||
											selectedQuantities[addon.id] >= addon.total_quantity ||
											isLocked}
										class={cn(isLocked && 'cursor-not-allowed opacity-50')}
									>
										+
									</Button>
								</div>
								<div class="flex flex-col items-end gap-1">
									{#if addon.total_quantity !== null}
										<div class="text-sm text-muted-foreground">
											Max antal: {addon.total_quantity}
										</div>
									{/if}
									{#if addon.price === 0 || addon.price === undefined}
										<div class="text-sm font-medium">Ingår</div>
									{:else if selectedQuantities[addon.id]}
										<div class="text-sm font-medium">
											Totalt: {formatPrice(
												getDisplayPrice(
													(addon.price ?? 0) * selectedQuantities[addon.id],
													experienceType
												)
											)}
											{#if experienceType === 'private'}
												<span class="text-xs">(inkl. moms)</span>
											{:else}
												<span class="text-xs">(exkl. moms)</span>
											{/if}
										</div>
									{/if}
								</div>
							{:else}
								<div class="flex w-full items-center justify-between">
									<Button
										variant={selectedPerPersonAddons[addon.id] ? 'default' : 'outline'}
										onclick={() => togglePerPersonAddon(addon.id)}
										disabled={isLocked}
										class={cn('w-full', isLocked && 'cursor-not-allowed opacity-50')}
									>
										{selectedPerPersonAddons[addon.id] ? 'Vald' : 'Välj'}
									</Button>
									{#if addon.price === 0 || addon.price === undefined}
										<div class="ml-4 text-sm font-medium">Ingår</div>
									{:else if selectedPerPersonAddons[addon.id]}
										<div class="ml-4 text-sm font-medium">
											Totalt: {formatPrice(
												getDisplayPrice((addon.price ?? 0) * payingCustomers, experienceType)
											)}
											{#if experienceType === 'private'}
												<span class="text-xs">(inkl. moms)</span>
											{:else}
												<span class="text-xs">(exkl. moms)</span>
											{/if}
										</div>
									{/if}
								</div>
							{/if}
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>
