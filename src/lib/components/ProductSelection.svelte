<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';

	interface Product {
		id: number;
		name: string;
		description: string;
		total_quantity: number;
		imageUrl: string;
	}

	let {
		products,
		preloadedImages,
		onProductsSelected = (products: Array<{ productId: number; quantity: number }>) => {}
	} = $props<{
		products: Product[];
		preloadedImages: Set<string>;
		onProductsSelected?: (products: Array<{ productId: number; quantity: number }>) => void;
	}>();

	let selectedQuantities = $state<Record<number, number>>({});
	let allImagesLoaded = $state(false);
	let initialLoadDone = $state(false);

	// Handle image loading once when products change
	$effect(() => {
		if (products.length > 0 && !initialLoadDone) {
			initialLoadDone = true;
			const unloadedImages = products.filter(
				(product: Product) => !preloadedImages.has(product.imageUrl)
			);

			if (unloadedImages.length === 0) {
				allImagesLoaded = true;
				return;
			}

			Promise.all(
				unloadedImages.map(
					(product: Product) =>
						new Promise<void>((resolve) => {
							if (preloadedImages.has(product.imageUrl)) {
								resolve();
								return;
							}
							const img = new Image();
							img.onload = () => {
								preloadedImages.add(product.imageUrl);
								resolve();
							};
							img.src = product.imageUrl;
						})
				)
			).then(() => {
				allImagesLoaded = true;
			});
		}
	});

	function incrementProduct(productId: number) {
		const currentQuantity = selectedQuantities[productId] || 0;
		const product = products.find((p: Product) => p.id === productId);

		if (product && currentQuantity < product.total_quantity) {
			selectedQuantities[productId] = currentQuantity + 1;
		}
	}

	function decrementProduct(productId: number) {
		const currentQuantity = selectedQuantities[productId] || 0;

		if (currentQuantity > 0) {
			selectedQuantities[productId] = currentQuantity - 1;
		}
	}

	// Notify parent of quantity changes
	$effect(() => {
		const selectedProducts = Object.entries(selectedQuantities)
			.filter(([_, quantity]) => quantity > 0)
			.map(([productId, quantity]) => ({
				productId: parseInt(productId),
				quantity
			}));

		onProductsSelected(selectedProducts);
	});
</script>

<div class="grid gap-4">
	{#each products as product, index (product.id)}
		<Card>
			<CardHeader class="flex flex-row gap-4">
				<div class="relative h-24 w-24">
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
				<div>
					<CardTitle>{product.name}</CardTitle>
					<CardDescription>{product.description}</CardDescription>
				</div>
			</CardHeader>
			<CardContent>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-4">
						<Button
							variant="outline"
							size="icon"
							onclick={() => decrementProduct(product.id)}
							disabled={!selectedQuantities[product.id]}
						>
							-
						</Button>
						<span class="w-8 text-center">{selectedQuantities[product.id] || 0}</span>
						<Button
							variant="outline"
							size="icon"
							onclick={() => incrementProduct(product.id)}
							disabled={selectedQuantities[product.id] >= product.total_quantity}
						>
							+
						</Button>
					</div>
					<div class="text-sm text-muted-foreground">
						Max antal: {product.total_quantity}
					</div>
				</div>
			</CardContent>
		</Card>
	{/each}
</div>
