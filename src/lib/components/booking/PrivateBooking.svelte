<script lang="ts">
	import StartLocations from '$lib/components/StartLocations.svelte';
	import BookingDurations from '$lib/components/BookingDurations.svelte';
	import Calendar from '$lib/components/Calendar.svelte';
	import ProductSelection from '$lib/components/ProductSelection.svelte';
	import AvailableStartTimes from '$lib/components/AvailableStartTimes.svelte';
	import PriceGroupSelector from '$lib/components/PriceGroupSelector.svelte';

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

	interface PriceGroup {
		id: number;
		experience_id: number;
		start_location_id: number | null;
		internal_name: string;
		display_name: string;
		price: number;
	}

	let {
		experience,
		startLocations,
		openDates = [],
		blockedDates = [],
		productsByLocation = {},
		priceGroups = []
	} = $props<{
		experience: Experience;
		startLocations: StartLocation[];
		openDates: OpenDate[];
		blockedDates: BlockedDate[];
		productsByLocation: Record<number, Product[]>;
		priceGroups: PriceGroup[];
	}>();

	let selectedLocationId = $state<number | null>(null);
	let selectedDuration = $state('');
	let durationType = $state<'hours' | 'overnights'>('hours');
	let durationValue = $state(0);
	let selectedDate = $state<Date | null>(null);
	// @ts-ignore - Used in template binding
	let durationsSection = $state<HTMLElement | null>(null);
	let calendarSection = $state<HTMLElement | null>(null);
	let productsSection = $state<HTMLElement | null>(null);
	let priceGroupSection = $state<HTMLElement | null>(null);
	let durations = $state<any[]>([]);
	let isLoadingDurations = $state(false);
	let preloadedImages = $state(new Set<string>());
	let selectedProducts = $state<Array<{ productId: number; quantity: number }>>([]);
	let isBookingLocked = $state(false);
	let priceGroupQuantities = $state<Record<number, number>>({});
	let showDurations = $state(false);

	let shouldShowDurations = $derived(
		showDurations && Object.values(priceGroupQuantities).some((quantity) => quantity > 0)
	);
	let shouldShowProducts = $derived(
		selectedDate !== null &&
			selectedLocationId !== null &&
			productsByLocation[selectedLocationId]?.length > 0
	);

	// Start preloading images for all products immediately
	$effect(() => {
		if (selectedLocationId) {
			// Only preload images for the selected location
			const productsForLocation = productsByLocation[selectedLocationId] || [];
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

	function handleLocationSelect(locationId: string) {
		const newLocationId = parseInt(locationId);
		// Only reset if location actually changed
		if (selectedLocationId !== newLocationId) {
			selectedLocationId = newLocationId;
			// Reset all dependent state
			priceGroupQuantities = {};
			selectedDuration = '';
			durationType = 'hours';
			durationValue = 0;
			selectedDate = null;
			selectedProducts = [];
			showDurations = false;
			isBookingLocked = false;
		}
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
	}

	function handleLockStateChange(locked: boolean) {
		isBookingLocked = locked;
	}

	function getStartLocationHeading() {
		return startLocations.length === 1 ? 'Din startplats' : 'Välj en startplats';
	}

	function getDurationHeading() {
		return durations.length === 1 ? 'Din bokningslängd' : 'Välj längd på bokning';
	}

	function handlePriceGroupQuantityChange(quantities: Record<number, number>) {
		priceGroupQuantities = quantities;
	}

	function handleNextStep() {
		showDurations = true;
		// Add small delay to ensure component has rendered
		setTimeout(() => {
			window.scrollTo({
				top: document.documentElement.scrollHeight,
				behavior: 'smooth'
			});
		}, 100);
	}

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

	$effect(() => {
		if (selectedLocationId !== null && priceGroupSection) {
			setTimeout(() => {
				priceGroupSection?.scrollIntoView({ behavior: 'smooth' });
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
		<StartLocations {startLocations} onSelect={handleLocationSelect} isLocked={isBookingLocked} />
	</section>

	{#if selectedLocationId !== null}
		<section class="space-y-4" bind:this={priceGroupSection}>
			<PriceGroupSelector
				{priceGroups}
				startLocationId={selectedLocationId}
				onQuantityChange={handlePriceGroupQuantityChange}
				isLocked={isBookingLocked}
				onNextStep={handleNextStep}
				includeVat={true}
			/>
		</section>
	{/if}

	{#if shouldShowDurations}
		<section class="space-y-4" bind:this={durationsSection}>
			<h2 class="text-center text-2xl font-semibold">{getDurationHeading()}</h2>
			<div class="flex justify-center">
				<BookingDurations
					startLocationId={selectedLocationId!.toString()}
					bind:selectedDuration
					bind:durations
					bind:isLoading={isLoadingDurations}
					onDurationSelect={handleDurationSelect}
					isLocked={isBookingLocked}
				/>
			</div>
		</section>

		{#if selectedDuration}
			<section class="space-y-4" bind:this={calendarSection}>
				<h2 class="text-center text-2xl font-semibold">Välj startdatum</h2>
				<div class="flex justify-center">
					<Calendar
						{durationType}
						{durationValue}
						{openDates}
						{blockedDates}
						onDateSelect={handleDateSelect}
						isLocked={isBookingLocked}
					/>
				</div>
			</section>

			{#if selectedDate}
				{#if shouldShowProducts}
					<section class="space-y-4" bind:this={productsSection}>
						<h2 class="text-center text-2xl font-semibold">Välj utrustning</h2>
						{#if productsByLocation[selectedLocationId!]?.length > 0}
							<div class="mx-auto max-w-2xl">
								<ProductSelection
									products={productsByLocation[selectedLocationId!] || []}
									{preloadedImages}
									onProductsSelected={handleProductSelection}
									isLocked={isBookingLocked}
								/>
							</div>

							{@const props = {
								experienceId: parseInt(experience.id),
								selectedDate,
								durationType,
								durationValue,
								selectedProducts,
								onLockStateChange: handleLockStateChange
							}}
							<div class="mx-auto mt-4 max-w-2xl">
								<AvailableStartTimes {...props} />
							</div>
						{:else}
							<p class="text-center text-muted-foreground">
								Ingen utrustning tillgänglig för denna startplats.
							</p>
						{/if}
					</section>
				{/if}
			{/if}
		{/if}
	{/if}
</div>
