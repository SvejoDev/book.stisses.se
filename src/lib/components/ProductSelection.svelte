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

	let { products, preloadedImages } = $props<{
		products: Product[];
		preloadedImages: Set<string>;
	}>();

	let selectedProducts = $state<Record<number, number>>({});
	let allImagesLoaded = $state(false);
	let loadingPromises: Promise<void>[] = [];

	// Load all images simultaneously
	$effect(() => {
		if (products.length > 0) {
			loadingPromises = products.map((product: Product) => {
				if (!preloadedImages.has(product.imageUrl)) {
					return new Promise<void>((resolve) => {
						const img = new Image();
						img.onload = () => {
							preloadedImages.add(product.imageUrl);
							resolve();
						};
						img.src = product.imageUrl;
					});
				}
				return Promise.resolve();
			});

			Promise.all(loadingPromises).then(() => {
				allImagesLoaded = true;
			});
		}
	});

	function incrementProduct(productId: number) {
		const currentQuantity = selectedProducts[productId] || 0;
		const product = products.find((p: Product) => p.id === productId);

		if (product && currentQuantity < product.total_quantity) {
			selectedProducts[productId] = currentQuantity + 1;
		}
	}

	function decrementProduct(productId: number) {
		const currentQuantity = selectedProducts[productId] || 0;

		if (currentQuantity > 0) {
			selectedProducts[productId] = currentQuantity - 1;
		}
	}

	$effect(() => {
		Object.entries(selectedProducts).forEach(([productId, quantity]) => {
			if (quantity > 0) {
				const product = products.find((p: Product) => p.id === Number(productId));
				console.log(`Product: ${product?.name}, Quantity: ${quantity}`);
			}
		});
	});

	// Determine if a product should be eagerly loaded (first 2 products)
	function shouldEagerLoad(index: number): boolean {
		return index < 2;
	}
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
						loading="eager"
						fetchpriority="high"
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
							disabled={!selectedProducts[product.id]}
						>
							-
						</Button>
						<span class="w-8 text-center">{selectedProducts[product.id] || 0}</span>
						<Button
							variant="outline"
							size="icon"
							onclick={() => incrementProduct(product.id)}
							disabled={selectedProducts[product.id] >= product.total_quantity}
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
