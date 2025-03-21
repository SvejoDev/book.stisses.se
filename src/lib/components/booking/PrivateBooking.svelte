<script lang="ts">
	import StartLocations from '$lib/components/StartLocations.svelte';
	import BookingDurations from '$lib/components/BookingDurations.svelte';
	import Calendar from '$lib/components/Calendar.svelte';
	import ProductSelection from '$lib/components/ProductSelection.svelte';
	import AvailableStartTimes from '$lib/components/AvailableStartTimes.svelte';

	interface Experience {
		id: string;
		type: 'private';
		name: string;
	}

	interface StartLocation {
		id: number;
		experience_id: number;
		name: string;
		price_per_person: number;
	}

	interface OpenDate {
		id: number;
		experience_id: number;
		type: 'interval' | 'specific';
		start_date: string | null;
		end_date: string | null;
		specific_date: string | null;
		created_at: string;
	}

	interface BlockedDate {
		id: number;
		experience_id: number;
		start_date: string;
		end_date: string;
		reason: string | null;
		created_at: string;
	}

	interface Product {
		id: number;
		name: string;
		description: string;
		total_quantity: number;
		imageUrl: string;
	}

	let {
		experience,
		startLocations,
		openDates = [],
		blockedDates = [],
		productsByLocation = {}
	} = $props<{
		experience: Experience;
		startLocations: StartLocation[];
		openDates: OpenDate[];
		blockedDates: BlockedDate[];
		productsByLocation: Record<number, Product[]>;
	}>();

	let selectedStartLocation = $state<string | null>(null);
	let selectedDuration = $state('');
	let durationType = $state<'hours' | 'overnights'>('hours');
	let durationValue = $state(0);
	let selectedDate = $state<Date | null>(null);
	let durationsSection = $state<HTMLElement | null>(null);
	let calendarSection = $state<HTMLElement | null>(null);
	let productsSection = $state<HTMLElement | null>(null);
	let durations = $state<any[]>([]);
	let isLoadingDurations = $state(false);
	let preloadedImages = $state(new Set<string>());
	let selectedProducts = $state<Array<{ productId: number; quantity: number }>>([]);

	let isSingleLocation = $derived(startLocations.length === 1);
	let shouldShowDurations = $derived(isSingleLocation || selectedStartLocation !== null);
	let shouldShowProducts = $derived(
		selectedDate !== null &&
			selectedStartLocation !== null &&
			productsByLocation[Number(selectedStartLocation)]?.length > 0
	);

	// Start preloading images for all products immediately
	$effect(() => {
		if (selectedStartLocation) {
			// Only preload images for the selected location
			const productsForLocation = productsByLocation[Number(selectedStartLocation)] || [];
			productsForLocation.forEach((product: Product) => {
				if (!preloadedImages.has(product.imageUrl)) {
					const img = new Image();
					img.src = product.imageUrl;
					img.onload = () => {
						preloadedImages.add(product.imageUrl);
					};
				}
			});
		}
	});

	function handleStartLocationSelect(locationId: string) {
		selectedStartLocation = locationId;
		if (!isSingleLocation) {
			durationsSection?.scrollIntoView({ behavior: 'smooth' });
		}
		// Prioritize loading images for selected location
		const productsForLocation = productsByLocation[Number(locationId)] || [];
		productsForLocation.forEach((product: Product) => {
			if (!preloadedImages.has(product.imageUrl)) {
				const img = new Image();
				img.onload = () => {
					preloadedImages.add(product.imageUrl);
				};
				img.src = product.imageUrl;
			}
		});
	}

	function handleDurationSelect(duration: { type: string; value: number }) {
		durationType = duration.type as 'hours' | 'overnights';
		durationValue = duration.value;
		calendarSection?.scrollIntoView({ behavior: 'smooth' });
	}

	function handleDateSelect(date: Date) {
		selectedDate = date;
		productsSection?.scrollIntoView({ behavior: 'smooth' });
	}

	function handleProductSelection(products: Array<{ productId: number; quantity: number }>) {
		selectedProducts = products;
		$inspect(selectedProducts, 'Selected products');
	}

	function getStartLocationHeading() {
		return startLocations.length === 1 ? 'Din startplats' : 'Välj en startplats';
	}

	function getDurationHeading() {
		return durations.length === 1 ? 'Din bokningslängd' : 'Välj längd på bokning';
	}

	$effect(() => {
		if (selectedDate) {
			console.log('Selected date:', selectedDate);
		}
	});

	$effect(() => {
		if (shouldShowProducts && productsSection) {
			setTimeout(() => {
				window.scrollTo({
					top: document.documentElement.scrollHeight,
					behavior: 'smooth'
				});
			}, 100); // Small delay to ensure DOM is updated
		}
	});
</script>

<div class="space-y-8">
	<header class="text-center">
		<h1 class="text-4xl font-bold tracking-tight">{experience.name}</h1>
	</header>

	<section class="space-y-4">
		<h2 class="text-center text-2xl font-semibold">{getStartLocationHeading()}</h2>
		<StartLocations {startLocations} onSelect={handleStartLocationSelect} />
	</section>

	{#if shouldShowDurations}
		<section class="space-y-4" bind:this={durationsSection}>
			<h2 class="text-center text-2xl font-semibold">{getDurationHeading()}</h2>
			<div class="flex justify-center">
				<BookingDurations
					startLocationId={selectedStartLocation}
					bind:selectedDuration
					bind:durations
					bind:isLoading={isLoadingDurations}
					onDurationSelect={handleDurationSelect}
				/>
			</div>
		</section>

		{#if selectedDuration}
			<section class="space-y-4" bind:this={calendarSection}>
				<h2 class="text-center text-2xl font-semibold">Välj startdatum</h2>
				<div class="flex justify-center">
					<Calendar
						{selectedDuration}
						{durationType}
						{durationValue}
						{openDates}
						{blockedDates}
						onDateSelect={handleDateSelect}
					/>
				</div>
			</section>

			{#if shouldShowProducts}
				<section class="space-y-4" bind:this={productsSection}>
					<h2 class="text-center text-2xl font-semibold">Välj utrustning</h2>
					{#if productsByLocation[Number(selectedStartLocation)]?.length > 0}
						<div class="mx-auto max-w-2xl">
							<ProductSelection
								products={productsByLocation[Number(selectedStartLocation)] || []}
								{preloadedImages}
								onProductsSelected={handleProductSelection}
							/>
						</div>

						{#if selectedProducts.length > 0 && selectedDate}
							{@const props = {
								experienceId: parseInt(experience.id),
								selectedDate,
								durationType,
								durationValue,
								selectedProducts
							}}
							<div class="mx-auto max-w-2xl">
								<AvailableStartTimes {...props} />
							</div>
						{/if}
					{:else}
						<p class="text-center text-muted-foreground">
							Ingen utrustning tillgänglig för denna startplats.
						</p>
					{/if}
				</section>
			{/if}
		{/if}
	{/if}
</div>
