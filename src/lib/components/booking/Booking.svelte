<script lang="ts">
	import StartLocations from '$lib/components/StartLocations.svelte';
	import BookingDurations from '$lib/components/BookingDurations.svelte';
	import Calendar from '$lib/components/Calendar.svelte';
	import ProductSelection from '$lib/components/ProductSelection.svelte';
	import AddonSelection from '$lib/components/AddonSelection.svelte';
	import AvailableStartTimes from '$lib/components/AvailableStartTimes.svelte';
	import PriceGroupSelector from '$lib/components/PriceGroupSelector.svelte';
	import ContactForm from '$lib/components/ContactForm.svelte';
	import { getDisplayPrice, formatPrice } from '$lib/utils/price';
	import type {
		Experience,
		StartLocation,
		Duration,
		OpenDate,
		BlockedDate,
		PriceGroup,
		SelectedProduct,
		SelectedAddon,
		SelectedStartTime
	} from '$lib/types/booking';

	// Props
	let {
		experience,
		startLocations,
		openDates = [],
		blockedDates = [],
		priceGroups = [],
		pricingType = 'per_person'
	} = $props<{
		experience: Experience;
		startLocations: StartLocation[];
		openDates?: OpenDate[];
		blockedDates?: BlockedDate[];
		priceGroups?: PriceGroup[];
		pricingType?: 'per_person' | 'per_product' | 'hybrid';
	}>();

	// Reactive state
	let selectedLocationId = $state<number | null>(null);
	let selectedDuration = $state('');
	let durationType = $state<'hours' | 'overnights'>('hours');
	let durationValue = $state(0);
	let selectedDate = $state<Date | null>(null);
	let resetStartLocations = $state(false);
	let durationsSection = $state<HTMLElement | null>(null);
	let calendarSection = $state<HTMLElement | null>(null);
	let productsSection = $state<HTMLElement | null>(null);
	let addonsSection = $state<HTMLElement | null>(null);
	let priceGroupSection = $state<HTMLElement | null>(null);
	let isLoadingDurations = $state(false);
	let selectedProducts = $state<SelectedProduct[]>([]);
	let selectedAddons = $state<SelectedAddon[]>([]);
	let isBookingLocked = $state(false);
	let priceGroupQuantities = $state<Record<number, number>>({});
	let showDurations = $state(false);
	let extraPrice = $state(0);
	let durations = $state<Duration[]>([]);
	let priceGroupRef = $state<{
		totalAmount: () => number;
		getPayingCustomers: () => number;
	} | null>(null);

	// Derived state
	let totalPrice = /** @readonly */ $derived(() => {
		const productTotal = selectedProducts.reduce((sum, p) => sum + (p.price || 0) * p.quantity, 0);
		const addonTotal = selectedAddons.reduce((sum, a) => sum + (a.price || 0) * a.quantity, 0);
		const priceGroupTotal = priceGroupRef?.totalAmount() ?? 0;
		const durationTotal = extraPrice * (priceGroupRef?.getPayingCustomers() ?? 0);
		return productTotal + addonTotal + priceGroupTotal + durationTotal;
	});

	let displayTotal = /** @readonly */ $derived(() => {
		return getDisplayPrice(totalPrice(), experience.type);
	});

	let hasStartLocations = /** @readonly */ $derived(startLocations.length > 0);

	let shouldShowDurations = /** @readonly */ $derived(
		showDurations && (selectedLocationId !== null || !hasStartLocations)
	);
	let shouldShowProducts = /** @readonly */ $derived(
		selectedDate !== null && (selectedLocationId !== null || !hasStartLocations)
	);

	// Effects
	$effect(() => {
		if (!hasStartLocations) selectedLocationId = null;
	});

	let productsLoaded = $state(false);
	$effect(() => {
		if (selectedDate && shouldShowProducts && productsLoaded) {
			const isMobile = window.innerWidth < 768;
			if (!isMobile) setTimeout(() => scrollToElement(addonsSection), 300);
		}
	});

	function scrollToElement(element: HTMLElement | null) {
		if (!element) return;
		const rect = element.getBoundingClientRect();
		const top = rect.top + window.pageYOffset;
		const isMobile = window.innerWidth < 768;
		const scrollPos = isMobile ? top : top - window.innerHeight / 3;
		window.scrollTo({ top: scrollPos, behavior: 'smooth' });
	}

	function handleLocationSelect(loc: string) {
		const newId = parseInt(loc);
		if (selectedLocationId !== newId) {
			selectedLocationId = newId;
			priceGroupQuantities = {};
			selectedDuration = '';
			durationType = 'hours';
			durationValue = 0;
			selectedDate = null;
			selectedProducts = [];
			selectedAddons = [];
			showDurations = false;
			isBookingLocked = false;
			setTimeout(() => scrollToElement(priceGroupSection), 100);
		}
	}

	function handleDurationSelect(d: { type: string; value: number; extraPrice: number }) {
		durationType = d.type as 'hours' | 'overnights';
		durationValue = d.value;
		extraPrice = d.extraPrice;
		scrollToElement(calendarSection);
	}

	function handleDateSelect(date: Date | null) {
		selectedDate = date;
		if (date)
			setTimeout(() => {
				if (shouldShowProducts && window.innerWidth < 768) scrollToElement(productsSection);
			}, 300);
	}

	function handleProductSelection(prods: SelectedProduct[]) {
		selectedProducts = prods;
	}

	function handleAddonSelection(adds: SelectedAddon[]) {
		selectedAddons = adds;
	}

	// Handle locking state from child components
	function handleLockStateChange(locked: boolean) {
		isBookingLocked = locked;
	}

	function handlePriceGroupQuantityChange(q: Record<number, number>) {
		priceGroupQuantities = q;
	}

	function handleNextStep() {
		showDurations = true;
		setTimeout(() => scrollToElement(durationsSection), 100);
	}

	function handleAddonsLoaded() {
		scrollToElement(addonsSection);
	}

	// Multi-booking state
	let showAvailableTimesButton = $state(false);
	let showContactForm = $state(false);
	let selectedStartTime = $state<SelectedStartTime | null>(null);
	let showMultipleBookingOption = $state(false);
	let currentBookingIndex = $state(0);
	let totalBookings = $state(1);
	let allBookings = $state<
		Array<{
			selectedLocationId: number | null;
			selectedDuration: string;
			durationType: 'hours' | 'overnights';
			durationValue: number;
			selectedDate: Date | null;
			selectedProducts: SelectedProduct[];
			selectedAddons: SelectedAddon[];
			priceGroupQuantities: Record<number, number>;
			selectedStartTime: SelectedStartTime | null;
			totalPrice: number;
		}>
	>([
		{
			selectedLocationId: null,
			selectedDuration: '',
			durationType: 'hours',
			durationValue: 0,
			selectedDate: null,
			selectedProducts: [],
			selectedAddons: [],
			priceGroupQuantities: {},
			selectedStartTime: null,
			totalPrice: 0
		}
	]);

	let bookingOptionsSection = $state<HTMLElement | null>(null);

	function handleStartTimeSelect(time: SelectedStartTime) {
		selectedStartTime = time;
		showMultipleBookingOption = true;
		allBookings[currentBookingIndex] = {
			selectedLocationId,
			selectedDuration,
			durationType,
			durationValue,
			selectedDate,
			selectedProducts,
			selectedAddons,
			priceGroupQuantities,
			selectedStartTime: time,
			totalPrice: totalPrice()
		};
		setTimeout(() => scrollToElement(bookingOptionsSection), 100);
	}

	function addAnotherBooking() {
		allBookings[currentBookingIndex] = {
			selectedLocationId,
			selectedDuration,
			durationType,
			durationValue,
			selectedDate,
			selectedProducts,
			selectedAddons,
			priceGroupQuantities,
			selectedStartTime,
			totalPrice: totalPrice()
		};
		totalBookings++;
		currentBookingIndex++;
		selectedLocationId = null;
		selectedDuration = '';
		durationType = 'hours';
		durationValue = 0;
		selectedDate = null;
		selectedProducts = [];
		selectedAddons = [];
		priceGroupQuantities = {};
		selectedStartTime = null;
		showMultipleBookingOption = false;
		showDurations = false;
		resetStartLocations = true;
		isBookingLocked = false;
		showAvailableTimesButton = false;
		showContactForm = false;
		allBookings.push({
			selectedLocationId: null,
			selectedDuration: '',
			durationType: 'hours',
			durationValue: 0,
			selectedDate: null,
			selectedProducts: [],
			selectedAddons: [],
			priceGroupQuantities: {},
			selectedStartTime: null,
			totalPrice: 0
		});
		window.scrollTo({ top: 0, behavior: 'smooth' });
		setTimeout(() => (resetStartLocations = false), 100);
	}

	function proceedToContactForm() {
		showContactForm = true;
		setTimeout(
			() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }),
			100
		);
	}

	let totalPriceForAllBookings = /** @readonly */ $derived(() =>
		allBookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0)
	);
	let displayTotalForAllBookings = /** @readonly */ $derived(() =>
		getDisplayPrice(totalPriceForAllBookings(), experience.type)
	);

	export function getTotalPrice(): number {
		return totalPrice();
	}
</script>

<div class="space-y-16">
	<header class="text-center">
		<h1 class="text-4xl font-bold tracking-tight">{experience.name}</h1>
	</header>

	{#if totalBookings > 1}
		<div
			class="fixed left-4 top-4 z-10 rounded-lg bg-primary/10 px-3 py-2 text-sm font-medium text-primary shadow-sm"
		>
			Du har {totalBookings - 1} bokning{totalBookings - 1 === 1 ? '' : 'ar'} i din kundvagn
		</div>
	{/if}

	{#if hasStartLocations}
		<section class="space-y-4">
			<h2 class="text-center text-2xl font-semibold">
				{startLocations.length === 1 ? 'Din startplats' : 'Välj en startplats'}
			</h2>
			<StartLocations
				{startLocations}
				onSelect={handleLocationSelect}
				isLocked={isBookingLocked}
				reset={resetStartLocations}
			/>
		</section>
	{/if}

	{#if selectedLocationId !== null || !hasStartLocations}
		<section class="space-y-4" bind:this={priceGroupSection}>
			<PriceGroupSelector
				bind:this={priceGroupRef}
				{priceGroups}
				{pricingType}
				startLocationId={selectedLocationId ?? 0}
				onQuantityChange={handlePriceGroupQuantityChange}
				isLocked={isBookingLocked}
				onNextStep={handleNextStep}
				includeVat={experience.type === 'private'}
				{extraPrice}
				experienceType={experience.type}
			/>
		</section>
	{/if}

	{#if shouldShowDurations}
		<section class="space-y-4" bind:this={durationsSection}>
			<h2 class="text-center text-2xl font-semibold">
				{durations.length === 1 ? 'Din bokningslängd' : 'Välj längd på bokning'}
			</h2>
			<div class="flex justify-center">
				<BookingDurations
					startLocationId={(selectedLocationId ?? 0).toString()}
					experienceId={experience.id}
					bind:selectedDuration
					{durations}
					bind:isLoading={isLoadingDurations}
					onDurationSelect={handleDurationSelect}
					isLocked={isBookingLocked}
					experienceType={experience.type}
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
						experienceType={experience.type}
						includeVat={experience.type === 'private'}
					/>
				</section>

				<section class="space-y-4" bind:this={addonsSection}>
					<h2 class="text-center text-2xl font-semibold">Välj tillägg</h2>
					<AddonSelection
						startLocationId={selectedLocationId?.toString() ?? '0'}
						experienceId={experience.id}
						{selectedProducts}
						onAddonsSelected={handleAddonSelection}
						onAddonsLoaded={handleAddonsLoaded}
						isLocked={isBookingLocked}
						{pricingType}
						payingCustomers={priceGroupRef?.getPayingCustomers() ?? 0}
						onAddonsFetched={() => (showAvailableTimesButton = true)}
						includeVat={experience.type === 'private'}
						experienceType={experience.type}
					/>

					{#if pricingType !== 'per_person' && totalPrice() > 0}
						<div class="text-center text-xl font-semibold">
							Totalt att betala: {formatPrice(displayTotal())}
							<span class="text-sm text-muted-foreground"
								>({experience.type === 'private' ? 'inkl. moms' : 'exkl. moms'})</span
							>
						</div>
					{/if}

					<div class="mx-auto mt-4 max-w-2xl">
						<AvailableStartTimes
							{...{
								experienceId: parseInt(experience.id),
								selectedDate,
								durationType,
								durationValue,
								selectedProducts,
								selectedAddons,
								onLockStateChange: handleLockStateChange,
								onStartTimeSelect: handleStartTimeSelect
							}}
							showButton={showMultipleBookingOption || showAvailableTimesButton}
						/>
					</div>
				</section>
			{/if}
		{/if}
	{/if}

	{#if showMultipleBookingOption}
		<div class="mt-8 flex flex-col items-center gap-4" bind:this={bookingOptionsSection}>
			<button
				class="rounded-lg bg-primary px-6 py-3 text-lg font-semibold text-white shadow-md transition-colors hover:bg-primary/90"
				onclick={proceedToContactForm}>Fortsätt till kontaktuppgifter</button
			>
			<button
				class="rounded-lg border-2 border-primary px-4 py-2 text-primary transition-colors hover:bg-primary/10"
				onclick={addAnotherBooking}>Gör en bokning till</button
			>
		</div>
	{/if}

	{#if showContactForm && allBookings.some((b) => b.selectedStartTime)}
		<section class="space-y-4">
			<ContactForm
				totalPrice={totalPriceForAllBookings()}
				bookings={allBookings}
				experienceId={parseInt(experience.id)}
				experienceType={experience.type}
				products={selectedProducts}
				addons={selectedAddons}
			/>
		</section>
	{/if}
</div>
