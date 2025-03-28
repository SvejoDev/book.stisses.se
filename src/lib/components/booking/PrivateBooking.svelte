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
		booking_foresight_hours: number;
	}

	interface StartLocation {
		id: number;
		experience_id: number;
		name: string;
		price_per_person: number;
	}

	interface Duration {
		id: number;
		start_location_id: number;
		duration_type: string;
		duration_value: number;
		extra_price: number;
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

	interface SelectedProduct {
		productId: number;
		quantity: number;
		price?: number;
	}

	let {
		experience,
		startLocations,
		openDates = [],
		blockedDates = [],
		priceGroups = [],
		pricingType
	} = $props<{
		experience: Experience;
		startLocations: StartLocation[];
		openDates: OpenDate[];
		blockedDates: BlockedDate[];
		priceGroups: PriceGroup[];
		pricingType: 'per_person' | 'per_product' | 'hybrid';
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
	let isLoadingDurations = $state(false);
	let selectedProducts = $state<SelectedProduct[]>([]);
	let isBookingLocked = $state(false);
	let priceGroupQuantities = $state<Record<number, number>>({});
	let showDurations = $state(false);
	let extraPrice = $state(0);
	let durations = $state<Duration[]>([]);
	let priceGroupRef = $state<{ totalAmount: () => number } | null>(null);
	let totalPrice = $derived(() => {
		// Calculate product prices if applicable
		const productTotal = selectedProducts.reduce((sum, product) => {
			return sum + (product.price || 0) * product.quantity;
		}, 0);

		// Get the price group selector total
		const priceGroupTotal = priceGroupRef?.totalAmount() ?? 0;

		return productTotal + priceGroupTotal;
	});

	let hasStartLocations = $derived(startLocations.length > 0);

	let shouldShowDurations = $derived(
		(pricingType === 'per_product' && (selectedLocationId !== null || !hasStartLocations)) ||
			(showDurations && Object.values(priceGroupQuantities).some((quantity) => quantity > 0))
	);

	let shouldShowProducts = $derived(
		selectedDate !== null && (selectedLocationId !== null || !hasStartLocations)
	);

	// Auto-set selectedLocationId to null when there are no start locations
	$effect(() => {
		if (!hasStartLocations) {
			selectedLocationId = null;
		}
	});

	$effect(() => {
		console.log('Debug state:', {
			selectedDate,
			selectedLocationId,
			hasStartLocations,
			shouldShowProducts,
			shouldShowDurations
		});
	});

	// Add new effect to handle scrolling after products are loaded
	let productsLoaded = $state(false);

	$effect(() => {
		if (selectedDate && shouldShowProducts && productsLoaded) {
			setTimeout(() => {
				scrollToElement(productsSection);
			}, 300); // Increased timeout to ensure content is rendered
		}
	});

	function scrollToElement(element: HTMLElement | null) {
		if (element) {
			const elementRect = element.getBoundingClientRect();
			const absoluteElementTop = elementRect.top + window.pageYOffset;
			const middle = absoluteElementTop - window.innerHeight / 3;
			window.scrollTo({ top: middle, behavior: 'smooth' });
		}
	}

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
			showDurations = pricingType === 'per_product'; // Only auto-show for per_product
			isBookingLocked = false;

			// Add a small delay to ensure components are rendered
			setTimeout(() => {
				// If per_product pricing, scroll to durations
				if (pricingType === 'per_product') {
					scrollToElement(durationsSection);
				} else {
					// For other pricing types, scroll to price group selector
					scrollToElement(priceGroupSection);
				}
			}, 100);
		}
	}

	function handleDurationSelect(duration: { type: string; value: number; extraPrice: number }) {
		durationType = duration.type as 'hours' | 'overnights';
		durationValue = duration.value;
		extraPrice = duration.extraPrice;

		// Log the duration change
		console.log('Duration changed:', {
			type: durationType,
			value: durationValue,
			currentSelectedDate: selectedDate
		});

		// The Calendar component will handle resetting the date if needed
		// through its internal effect

		scrollToElement(calendarSection);
	}

	function handleDateSelect(date: Date | null) {
		console.log('Date selected:', date);
		selectedDate = date;

		if (date) {
			// Only scroll to products section if we have a valid date
			setTimeout(() => {
				if (shouldShowProducts) {
					scrollToElement(productsSection);
				}
			}, 300);
		}
	}

	function handleProductSelection(products: SelectedProduct[]) {
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
		setTimeout(() => {
			scrollToElement(durationsSection);
		}, 100);
	}
</script>

<div class="space-y-16">
	<header class="text-center">
		<h1 class="text-4xl font-bold tracking-tight">{experience.name}</h1>
	</header>

	{#if hasStartLocations}
		<section class="space-y-4">
			<h2 class="text-center text-2xl font-semibold">{getStartLocationHeading()}</h2>
			<StartLocations {startLocations} onSelect={handleLocationSelect} isLocked={isBookingLocked} />
		</section>
	{/if}

	{#if selectedLocationId !== null || !hasStartLocations}
		{#if pricingType !== 'per_product'}
			<section class="space-y-4" bind:this={priceGroupSection}>
				<PriceGroupSelector
					bind:this={priceGroupRef}
					{priceGroups}
					startLocationId={selectedLocationId ?? 0}
					onQuantityChange={handlePriceGroupQuantityChange}
					isLocked={isBookingLocked}
					onNextStep={handleNextStep}
					includeVat={true}
					{extraPrice}
				/>
			</section>
		{/if}
	{/if}

	{#if shouldShowDurations}
		<section class="space-y-4" bind:this={durationsSection}>
			<h2 class="text-center text-2xl font-semibold">{getDurationHeading()}</h2>
			<div class="flex justify-center">
				<BookingDurations
					startLocationId={(selectedLocationId ?? 0).toString()}
					experienceId={experience.id}
					bind:selectedDuration
					{durations}
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
						{blockedDates}
						{openDates}
						onDateSelect={handleDateSelect}
						isLocked={isBookingLocked}
						bookingForesightHours={experience.booking_foresight_hours}
					/>
				</div>
			</section>

			{#if selectedDate && shouldShowProducts}
				<section class="space-y-4" bind:this={productsSection}>
					<h2 class="text-center text-2xl font-semibold">Välj utrustning</h2>
					<ProductSelection
						startLocationId={selectedLocationId?.toString() ?? '0'}
						experienceId={experience.id}
						onProductsSelected={handleProductSelection}
						onProductsLoaded={() => (productsLoaded = true)}
						isLocked={isBookingLocked}
						{pricingType}
					/>

					{#if pricingType !== 'per_person' && totalPrice() > 0}
						<div class="text-center text-xl font-semibold">
							Totalt att betala: {totalPrice()} kr
						</div>
					{/if}

					{#if true}
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
					{/if}
				</section>
			{/if}
		{/if}
	{/if}
</div>
