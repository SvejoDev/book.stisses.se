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

	interface Product {
		id: number;
		name: string;
		description: string;
		total_quantity: number;
		imageUrl: string;
		price?: number;
	}

	let {
		startLocationId = $bindable(''),
		experienceId = $bindable(''),
		isLocked = $bindable(false),
		onProductsSelected = (
			products: Array<{ productId: number; quantity: number; price?: number }>
		) => {},
		onProductsLoaded = () => {},
		pricingType = $bindable<'per_person' | 'per_product' | 'hybrid'>('per_person')
	} = $props<{
		startLocationId: string;
		experienceId: string;
		isLocked?: boolean;
		onProductsSelected?: (
			products: Array<{ productId: number; quantity: number; price?: number }>
		) => void;
		onProductsLoaded?: () => void;
		pricingType?: 'per_person' | 'per_product' | 'hybrid';
	}>();

	let selectedQuantities = $state<Record<number, number>>({});
	let allImagesLoaded = $state(false);
	let initialLoadDone = $state(false);
	let isLoading = $state(true);
	let products = $state<Product[]>([]);
	let error = $state<string | null>(null);

	let totalProductPrice = $derived(() => {
		if (pricingType === 'per_person') return 0;

		return Object.entries(selectedQuantities).reduce((total, [productId, quantity]) => {
			const product = products.find((p) => p.id === parseInt(productId));
			if (product?.price) {
				return total + product.price * quantity;
			}
			return total;
		}, 0);
	});

	console.log('ProductSelection mounted with:', { startLocationId, experienceId });

	async function fetchProducts() {
		try {
			isLoading = true;
			error = null;

			const response = await fetch(
				`/api/products?startLocationId=${startLocationId}&experienceId=${experienceId}`
			);

			if (!response.ok) {
				throw new Error('Failed to fetch products');
			}

			products = await response.json();

			// Add a small delay if there are no products for better UX
			if (products.length === 0) {
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'An error occurred';
		} finally {
			isLoading = false;
		}
	}

	// Fetch products when startLocationId or experienceId changes
	$effect(() => {
		if (experienceId) {
			// Only require experienceId
			fetchProducts();
		}
	});

	// Handle image loading once when products change
	$effect(() => {
		if (products.length > 0 && !initialLoadDone) {
			initialLoadDone = true;
			const unloadedImages = products.filter((product) => !product.imageUrl);

			if (unloadedImages.length === 0) {
				allImagesLoaded = true;
				onProductsLoaded();
				return;
			}

			Promise.all(
				unloadedImages.map(
					(product) =>
						new Promise<void>((resolve) => {
							const img = new Image();
							img.onload = () => resolve();
							img.src = product.imageUrl;
						})
				)
			).then(() => {
				allImagesLoaded = true;
				onProductsLoaded();
			});
		}
	});

	function incrementProduct(productId: number) {
		if (isLocked) return;
		const currentQuantity = selectedQuantities[productId] || 0;
		const product = products.find((p) => p.id === productId);

		if (product && currentQuantity < product.total_quantity) {
			selectedQuantities[productId] = currentQuantity + 1;
		}
	}

	function decrementProduct(productId: number) {
		if (isLocked) return;
		const currentQuantity = selectedQuantities[productId] || 0;

		if (currentQuantity > 0) {
			selectedQuantities[productId] = currentQuantity - 1;
		}
	}

	// Notify parent of quantity changes
	$effect(() => {
		const selectedProducts = Object.entries(selectedQuantities)
			.filter(([_, quantity]) => quantity > 0)
			.map(([productId, quantity]) => {
				const product = products.find((p) => p.id === parseInt(productId));
				return {
					productId: parseInt(productId),
					quantity,
					price: product?.price
				};
			});

		onProductsSelected(selectedProducts);
	});
</script>

<div class="mx-auto max-w-3xl">
	{#if isLoading}
		<div class="flex h-24 items-center justify-center">
			<div
				class="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent"
			></div>
		</div>
	{:else if error}
		<div class="text-center text-destructive">
			<p>{error}</p>
		</div>
	{:else if products.length === 0}
		<div class="text-center text-muted-foreground">
			<p>Ingen utrustning tillgänglig för denna startplats.</p>
		</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2">
			{#each products as product, index (product.id)}
				<Card class="flex h-full flex-col">
					<CardHeader class="flex flex-row gap-4">
						<div class="relative h-24 w-24 flex-shrink-0">
							<img
								src={product.imageUrl}
								alt={product.name}
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
						</div>
						<div class="flex-grow">
							<CardTitle>{product.name}</CardTitle>
							<CardDescription>{product.description}</CardDescription>
							{#if product.price}
								<p class="mt-1 text-sm text-muted-foreground">{product.price} SEK</p>
							{/if}
						</div>
					</CardHeader>
					<CardContent class="mt-auto">
						<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
							<div class="flex items-center gap-4">
								<Button
									variant="outline"
									size="icon"
									onclick={() => decrementProduct(product.id)}
									disabled={!selectedQuantities[product.id] || isLocked}
									class={cn(isLocked && 'cursor-not-allowed opacity-50')}
								>
									-
								</Button>
								<span class="w-8 text-center">{selectedQuantities[product.id] || 0}</span>
								<Button
									variant="outline"
									size="icon"
									onclick={() => incrementProduct(product.id)}
									disabled={selectedQuantities[product.id] >= product.total_quantity || isLocked}
									class={cn(isLocked && 'cursor-not-allowed opacity-50')}
								>
									+
								</Button>
							</div>
							<div class="flex flex-col items-end gap-1">
								<div class="text-sm text-muted-foreground">
									Max antal: {product.total_quantity}
								</div>
								{#if product.price && selectedQuantities[product.id]}
									<div class="text-sm font-medium">
										Totalt: {product.price * selectedQuantities[product.id]} kr
									</div>
								{/if}
							</div>
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>
