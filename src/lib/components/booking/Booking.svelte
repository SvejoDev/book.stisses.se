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
		BlockedDate
	} from '$lib/types/experience';
	import type { SelectedProduct } from '$lib/types/product';
	import type { SelectedAddon } from '$lib/types/addon';
	import type { SelectedStartTime } from '$lib/types/availability';
	import { cn } from '$lib/utils';

	// Props
	let {
		experience,
		startLocations,
		openDates = [],
		blockedDates = [],
		pricingType = 'per_person'
	} = $props<{
		experience: Experience;
		startLocations: StartLocation[];
		openDates?: OpenDate[];
		blockedDates?: BlockedDate[];
		pricingType?: 'per_person' | 'per_product' | 'hybrid';
	}>();

	// Reactive state
	let selectedLocationId = $state<number | null>(null);
	let selectedLocationValue = $state('');
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

	// Keep selectedLocationValue in sync with selectedLocationId
	$effect(() => {
		if (selectedLocationId !== null) {
			const newValue = selectedLocationId.toString();
			if (selectedLocationValue !== newValue) {
				selectedLocationValue = newValue;
			}
		} else if (selectedLocationValue !== '') {
			selectedLocationValue = '';
		}
	});

	let productsLoaded = $state(false);
	$effect(() => {
		if (selectedDate && shouldShowProducts && productsLoaded) {
			if (typeof window !== 'undefined') {
				const isMobile = window.innerWidth < 768;
				if (!isMobile) setTimeout(() => scrollToElement(addonsSection), 300);
			}
		}
	});

	function scrollToElement(element: HTMLElement | null) {
		if (!element || typeof window === 'undefined') return;
		const rect = element.getBoundingClientRect();
		const top = rect.top + window.pageYOffset;
		const isMobile = window.innerWidth < 768;
		const scrollPos = isMobile ? top : top - window.innerHeight / 3;
		window.scrollTo({ top: scrollPos, behavior: 'smooth' });
	}

	let autoFetchAddons = $state(false);
	let isInitializing = $state(true);
	let isSaving = $state(false);
	let isResettingBooking = $state(false); // Track reset loading state

	// Set initialization to false after the component has mounted
	$effect(() => {
		// Use a timeout to ensure all initial effects have run
		const timeout = setTimeout(() => {
			isInitializing = false;
		}, 100);

		return () => clearTimeout(timeout);
	});

	// Track reset state from AvailableStartTimes component
	$effect(() => {
		if (availableStartTimesRef) {
			const checkResetState = () => {
				try {
					const isComponentResetting = availableStartTimesRef?.isResettingBooking?.() || false;
					if (isComponentResetting !== isResettingBooking) {
						isResettingBooking = isComponentResetting;
					}
				} catch (error) {
					// Method might not be available yet, ignore error
				}
			};

			// Check immediately and then periodically
			checkResetState();
			const interval = setInterval(checkResetState, 100);

			return () => clearInterval(interval);
		}
	});

	function handleLocationSelect(loc: string) {
		const newId = parseInt(loc);
		if (selectedLocationId !== newId) {
			// Temporarily disable auto-save during reset
			isInitializing = true;

			selectedLocationId = newId;
			selectedLocationValue = loc;
			priceGroupQuantities = {};
			selectedDuration = '';
			durationType = 'hours';
			durationValue = 0;
			selectedDate = null;
			selectedProducts = [];
			selectedAddons = [];
			showDurations = false;
			isBookingLocked = false;

			// Re-enable auto-save after reset is complete
			setTimeout(() => {
				isInitializing = false;
				scrollToElement(priceGroupSection);
			}, 100);
		}
	}

	function handleDurationSelect(d: { type: string; value: number; extraPrice: number }) {
		durationType = d.type as 'hours' | 'overnights';
		durationValue = d.value;
		extraPrice = d.extraPrice;
		scrollToElement(calendarSection);
		// Save state after duration selection
		setTimeout(() => saveStateIfNeeded(), 0);
	}

	function handleDateSelect(date: Date | null) {
		selectedDate = date;
		if (date)
			setTimeout(() => {
				if (shouldShowProducts && window.innerWidth < 768) scrollToElement(productsSection);
			}, 300);
		// Save state after date selection
		setTimeout(() => saveStateIfNeeded(), 0);
	}

	function handleProductSelection(prods: SelectedProduct[]) {
		selectedProducts = prods;
		// Save state after product selection
		setTimeout(() => saveStateIfNeeded(), 0);
	}

	function handleAddonSelection(adds: SelectedAddon[]) {
		selectedAddons = adds;
		// Save state after addon selection
		setTimeout(() => saveStateIfNeeded(), 0);
	}

	// Handle locking state from child components
	function handleLockStateChange(locked: boolean) {
		isBookingLocked = locked;
	}

	function handlePriceGroupQuantityChange(q: Record<number, number>) {
		priceGroupQuantities = q;
		// Save state after price group changes
		setTimeout(() => saveStateIfNeeded(), 0);
	}

	function handleNextStep() {
		showDurations = true;
		setTimeout(() => scrollToElement(durationsSection), 100);
	}

	function handleAddonsLoaded() {
		scrollToElement(addonsSection);
	}

	// Multi-booking state with comprehensive state management
	let showAvailableTimesButton = $state(false);
	let showContactForm = $state(false);
	let selectedStartTime = $state<SelectedStartTime | null>(null);
	let showMultipleBookingOption = $state(false);
	let currentBookingIndex = $state(0);
	let totalBookings = $state(1);
	let currentReservationGroupId = $state<string | null>(null);
	let removingBookingIndex = $state<number | null>(null); // Track which booking is being removed
	let showRemoveConfirmation = $state<{ index: number; booking: any } | null>(null);
	let availableStartTimesRef = $state<{
		getReservationGroupId: () => string | null;
		getBookingNumber: () => string | null;
		getReservationExpiry: () => Date | null;
		isResettingBooking: () => boolean;
	} | null>(null);

	// Enhanced booking state structure
	interface BookingState {
		// Form data
		selectedLocationId: number | null;
		selectedLocationValue: string;
		selectedDuration: string;
		durationType: 'hours' | 'overnights';
		durationValue: number;
		selectedDate: Date | null;
		selectedProducts: SelectedProduct[];
		selectedAddons: SelectedAddon[];
		priceGroupQuantities: Record<number, number>;
		selectedStartTime: SelectedStartTime | null;
		totalPrice: number;

		// UI state
		showDurations: boolean;
		productsLoaded: boolean;
		showAvailableTimesButton: boolean;
		autoFetchAddons: boolean;

		// Booking metadata
		bookingNumber?: string;
		isCompleted: boolean;
		lastModified: Date;
	}

	let allBookingsState = $state<BookingState[]>([
		{
			selectedLocationId: null,
			selectedLocationValue: '',
			selectedDuration: '',
			durationType: 'hours',
			durationValue: 0,
			selectedDate: null,
			selectedProducts: [],
			selectedAddons: [],
			priceGroupQuantities: {},
			selectedStartTime: null,
			totalPrice: 0,
			showDurations: false,
			productsLoaded: false,
			showAvailableTimesButton: false,
			autoFetchAddons: false,
			isCompleted: false,
			lastModified: new Date()
		}
	]);

	// Function to save current state to the booking array
	function saveCurrentBookingState() {
		if (isSaving) return; // Prevent recursive saves

		isSaving = true;
		allBookingsState[currentBookingIndex] = {
			selectedLocationId,
			selectedLocationValue,
			selectedDuration,
			durationType,
			durationValue,
			selectedDate,
			selectedProducts,
			selectedAddons,
			priceGroupQuantities,
			selectedStartTime,
			totalPrice: totalPrice(),
			showDurations,
			productsLoaded,
			showAvailableTimesButton,
			autoFetchAddons,
			isCompleted: !!selectedStartTime,
			lastModified: new Date(),
			bookingNumber: allBookingsState[currentBookingIndex]?.bookingNumber
		};
		isSaving = false;
	}

	// Function to restore state from booking array
	function restoreBookingState(index: number) {
		if (index < 0 || index >= allBookingsState.length) return;

		// Temporarily set initializing to prevent auto-save during restoration
		isInitializing = true;

		const booking = allBookingsState[index];

		// Restore form data
		selectedLocationId = booking.selectedLocationId;
		selectedLocationValue = booking.selectedLocationValue;
		selectedDuration = booking.selectedDuration;
		durationType = booking.durationType;
		durationValue = booking.durationValue;
		selectedDate = booking.selectedDate;
		selectedProducts = booking.selectedProducts;
		selectedAddons = booking.selectedAddons;
		priceGroupQuantities = booking.priceGroupQuantities;
		selectedStartTime = booking.selectedStartTime;

		// Restore UI state
		showDurations = booking.showDurations;
		productsLoaded = booking.productsLoaded;
		showAvailableTimesButton = booking.showAvailableTimesButton;
		autoFetchAddons = booking.autoFetchAddons || booking.isCompleted; // Auto-fetch addons for completed bookings

		// Reset some UI states that should be fresh
		showMultipleBookingOption = booking.isCompleted;
		resetStartLocations = false;
		isBookingLocked = booking.isCompleted;

		// Re-enable auto-save after a short delay
		setTimeout(() => {
			isInitializing = false;
		}, 100);
	}

	// Function to switch to a different booking
	function switchToBooking(index: number) {
		if (index === currentBookingIndex) return;

		// Save current state first
		saveCurrentBookingState();

		// Switch to the selected booking
		currentBookingIndex = index;
		restoreBookingState(index);

		// Update currentReservationGroupId based on whether we have completed bookings
		const hasCompletedBookings = allBookingsState.some((b) => b.isCompleted);
		if (!hasCompletedBookings) {
			currentReservationGroupId = null;
		} else if (availableStartTimesRef) {
			// Sync with the AvailableStartTimes component
			const groupId = availableStartTimesRef.getReservationGroupId();
			if (groupId) {
				currentReservationGroupId = groupId;
			}
		}

		// Scroll to top for better UX
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	// Derived booking data for reservation
	let currentBookingData = /** @readonly */ $derived(() => {
		// For experiences without start locations, selectedLocationId can be null
		const locationId = hasStartLocations ? selectedLocationId : 0;

		if (!selectedDate || (hasStartLocations && !selectedLocationId) || !selectedDuration) {
			return null;
		}

		const durationId = parseInt(selectedDuration);
		if (isNaN(durationId)) {
			console.error('Invalid duration ID:', selectedDuration);
			return null;
		}

		const bookingData = {
			firstName: '', // Will be filled in ContactForm
			lastName: '',
			email: '',
			phone: '',
			comment: '',
			experienceId: parseInt(experience.id),
			experienceType: experience.type,
			startLocationId: locationId,
			durationId: durationId,
			startDate: selectedDate.toISOString().split('T')[0],
			startTime: '', // Will be set when time is selected
			endTime: '', // Will be set when time is selected
			hasBookingGuarantee: true,
			totalPrice: totalPrice(),
			priceGroups: Object.entries(priceGroupQuantities).map(([id, quantity]) => ({
				id: parseInt(id),
				quantity
			})),
			products: selectedProducts || [],
			addons: selectedAddons || []
		};

		return bookingData;
	});

	let bookingOptionsSection = $state<HTMLElement | null>(null);

	function handleStartTimeSelect(time: SelectedStartTime) {
		selectedStartTime = time;

		// Get the current reservation group ID from the AvailableStartTimes component
		const newReservationGroupId = availableStartTimesRef?.getReservationGroupId() || null;

		// Always update to the latest reservation group ID from the component
		if (newReservationGroupId) {
			currentReservationGroupId = newReservationGroupId;
		}

		// Mark this booking as completed and save the booking number
		allBookingsState[currentBookingIndex].bookingNumber =
			availableStartTimesRef?.getBookingNumber() || undefined;
		allBookingsState[currentBookingIndex].isCompleted = true;
		allBookingsState[currentBookingIndex].selectedStartTime = time;

		// Save the updated state
		saveCurrentBookingState();

		// Since we have at least one completed booking, we can show options
		showMultipleBookingOption = true;
	}

	function handleBookingReset() {
		// Set loading state
		isResettingBooking = true;

		// Clear the selected start time when the AvailableStartTimes component resets
		selectedStartTime = null;

		// Update the current booking state to reflect the reset
		allBookingsState[currentBookingIndex].selectedStartTime = null;
		allBookingsState[currentBookingIndex].isCompleted = false;

		// Hide the booking options since the booking is no longer completed
		showMultipleBookingOption = false;

		// Save the updated state
		saveCurrentBookingState();

		// Clear loading state after a short delay to allow UI to update
		setTimeout(() => {
			isResettingBooking = false;
		}, 500);
	}

	function addAnotherBooking() {
		// Validate that we have a reservation group ID before proceeding
		if (!currentReservationGroupId) {
			console.error('No currentReservationGroupId available for extending reservation!');
			alert('Error: No reservation group found. Please try again.');
			return;
		}

		// Save current booking state
		saveCurrentBookingState();

		// Temporarily disable auto-save during reset
		isInitializing = true;

		// Add new booking to state array
		allBookingsState.push({
			selectedLocationId: null,
			selectedLocationValue: '',
			selectedDuration: '',
			durationType: 'hours',
			durationValue: 0,
			selectedDate: null,
			selectedProducts: [],
			selectedAddons: [],
			priceGroupQuantities: {},
			selectedStartTime: null,
			totalPrice: 0,
			showDurations: false,
			productsLoaded: false,
			showAvailableTimesButton: false,
			autoFetchAddons: false,
			isCompleted: false,
			lastModified: new Date()
		});

		// Update counters and reset UI state for new booking
		totalBookings++;
		currentBookingIndex++;
		selectedLocationId = null;
		selectedLocationValue = '';
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
		autoFetchAddons = false;

		// DON'T reset currentReservationGroupId - we want to extend the existing reservation

		window.scrollTo({ top: 0, behavior: 'smooth' });
		setTimeout(() => {
			resetStartLocations = false;
			isInitializing = false; // Re-enable auto-save
		}, 100);
	}

	function proceedToContactForm() {
		showContactForm = true;
		setTimeout(
			() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }),
			100
		);
	}

	function confirmRemoveBooking(index: number) {
		const booking = allBookingsState[index];
		if (booking.isCompleted) {
			// Show confirmation for completed bookings
			showRemoveConfirmation = { index, booking };
		} else {
			// Remove incomplete bookings immediately without confirmation
			removeBooking(index);
		}
	}

	async function removeBooking(indexToRemove: number) {
		// Prevent removing the last remaining booking
		if (allBookingsState.length <= 1) {
			return;
		}

		// Prevent spam clicking
		if (removingBookingIndex !== null) {
			return;
		}

		// Close confirmation dialog
		showRemoveConfirmation = null;
		removingBookingIndex = indexToRemove;

		try {
			const bookingToRemove = allBookingsState[indexToRemove];

			// Only clean up from database if the booking is completed (has a booking number)
			if (bookingToRemove.isCompleted && bookingToRemove.bookingNumber) {
				// Call cleanup API to remove from database and restore availability
				const response = await fetch('/api/cleanup-expired', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						bookingNumber: bookingToRemove.bookingNumber
					})
				});

				if (!response.ok) {
					throw new Error('Failed to cleanup booking from database');
				}

				console.log('✅ Immediate cleanup successful for booking:', bookingToRemove.bookingNumber);
			}

			// Check if this is the last completed booking in the current reservation group
			const completedBookingsInGroup = allBookingsState.filter(
				(booking, idx) => idx !== indexToRemove && booking.isCompleted
			);

			// If no more completed bookings remain, reset the reservation group ID
			// so the next booking starts a fresh reservation group
			if (completedBookingsInGroup.length === 0) {
				console.log(
					'No more completed bookings in reservation group, resetting currentReservationGroupId'
				);
				currentReservationGroupId = null;
			}

			// Remove the booking from the state array
			allBookingsState.splice(indexToRemove, 1);
			totalBookings--;

			// Adjust currentBookingIndex if necessary
			if (indexToRemove < currentBookingIndex) {
				// If we removed a booking before the current one, shift down
				currentBookingIndex--;
			} else if (indexToRemove === currentBookingIndex) {
				// If we removed the current booking, switch to a valid one
				if (currentBookingIndex >= allBookingsState.length) {
					currentBookingIndex = allBookingsState.length - 1;
				}
				// Restore the state of the new current booking
				restoreBookingState(currentBookingIndex);
			}

			// If no bookings are left, reset everything
			if (allBookingsState.length === 0) {
				window.location.href = window.location.pathname;
			}
		} catch (error) {
			console.error('Failed to remove booking:', error);
			alert('Det gick inte att ta bort bokningen. Försök igen.');
		} finally {
			removingBookingIndex = null;
		}
	}

	let totalPriceForAllBookings = /** @readonly */ $derived(() =>
		allBookingsState.reduce((sum, b) => sum + (b.totalPrice || 0), 0)
	);
	let displayTotalForAllBookings = /** @readonly */ $derived(() =>
		getDisplayPrice(totalPriceForAllBookings(), experience.type)
	);

	// Manual save function that can be called at specific interaction points
	function saveStateIfNeeded() {
		if (
			(selectedLocationId !== null || selectedDuration !== '' || selectedDate !== null) &&
			!resetStartLocations &&
			!isInitializing &&
			!isSaving
		) {
			saveCurrentBookingState();
		}
	}

	export function getTotalPrice(): number {
		return totalPrice();
	}
</script>

<div class="space-y-16">
	<header class="text-center">
		<h1 class="text-4xl font-bold tracking-tight">{experience.name}</h1>
	</header>

	<!-- Booking Navigation UI -->
	{#if totalBookings > 1 || allBookingsState.some((b) => b.isCompleted)}
		<div class="mx-auto max-w-4xl">
			<div class="rounded-lg border bg-card p-4">
				<h2 class="mb-4 text-lg font-semibold">Dina bokningar</h2>
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each allBookingsState as booking, index}
						<button
							class={cn(
								'flex flex-col items-start rounded-lg border p-3 text-left transition-all hover:bg-accent',
								currentBookingIndex === index && 'border-primary bg-primary/5',
								booking.isCompleted && 'border-green-200 bg-green-50'
							)}
							onclick={() => switchToBooking(index)}
						>
							<div class="flex w-full items-center justify-between">
								<span class="font-medium">Bokning {index + 1}</span>
								<div class="flex items-center gap-2">
									{#if booking.isCompleted}
										<span
											class="inline-flex items-center rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700"
										>
											Klar
										</span>
									{:else}
										<span
											class="inline-flex items-center rounded-full bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-700"
										>
											Pågår
										</span>
									{/if}
									{#if currentBookingIndex === index}
										<span
											class="inline-flex items-center rounded-full bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
										>
											Aktuell
										</span>
									{/if}
									{#if allBookingsState.length > 1}
										<button
											class="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
											onclick={(e) => {
												e.stopPropagation();
												confirmRemoveBooking(index);
											}}
											disabled={removingBookingIndex === index}
											title="Ta bort denna bokning"
										>
											{#if removingBookingIndex === index}
												<svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24">
													<circle
														class="opacity-25"
														cx="12"
														cy="12"
														r="10"
														stroke="currentColor"
														stroke-width="4"
														fill="none"
													></circle>
													<path
														class="opacity-75"
														fill="currentColor"
														d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
													></path>
												</svg>
											{:else}
												×
											{/if}
										</button>
									{/if}
								</div>
							</div>
							<div class="mt-2 space-y-1 text-sm text-muted-foreground">
								{#if booking.selectedDate && booking.selectedStartTime}
									<p>
										{booking.selectedDate.toLocaleDateString('sv-SE')} kl. {booking
											.selectedStartTime.startTime}
									</p>
								{:else if booking.selectedDate}
									<p>{booking.selectedDate.toLocaleDateString('sv-SE')}</p>
								{:else}
									<p>Datum ej valt</p>
								{/if}
								{#if booking.selectedProducts.length > 0}
									<p>
										{booking.selectedProducts.length} produkt{booking.selectedProducts.length === 1
											? ''
											: 'er'}
									</p>
								{/if}
								{#if booking.totalPrice > 0}
									<p class="font-medium text-foreground">
										{formatPrice(getDisplayPrice(booking.totalPrice, experience.type))}
									</p>
								{/if}
							</div>
						</button>
					{/each}
				</div>
				{#if !showContactForm}
					<div class="mt-4 flex justify-center gap-4">
						<button
							class="rounded-lg border-2 border-primary px-4 py-2 text-primary transition-colors hover:bg-primary/10"
							onclick={addAnotherBooking}
							disabled={!allBookingsState[currentBookingIndex].isCompleted}
						>
							Lägg till en bokning till
						</button>
						{#if allBookingsState.some((b) => b.isCompleted)}
							<button
								class="rounded-lg bg-primary px-6 py-3 text-white shadow-md transition-colors hover:bg-primary/90"
								onclick={proceedToContactForm}
							>
								Fortsätt till kontaktuppgifter
							</button>
						{/if}
					</div>
				{/if}
			</div>
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
				bind:selectedValue={selectedLocationValue}
			/>
		</section>
	{/if}

	{#if selectedLocationId !== null || !hasStartLocations}
		<section class="space-y-4" bind:this={priceGroupSection}>
			<PriceGroupSelector
				bind:this={priceGroupRef}
				{pricingType}
				experienceId={experience.id}
				startLocationId={selectedLocationId ?? 0}
				onQuantityChange={handlePriceGroupQuantityChange}
				isLocked={isBookingLocked}
				onNextStep={handleNextStep}
				includeVat={experience.type === 'private'}
				{extraPrice}
				experienceType={experience.type}
				initialQuantities={priceGroupQuantities}
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
					initialSelectedDuration={selectedDuration}
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
						bind:selectedDate
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
						initialSelectedProducts={selectedProducts}
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
						initialSelectedAddons={selectedAddons}
						autoFetch={autoFetchAddons}
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
						{#if currentBookingData}
							<AvailableStartTimes
								bind:this={availableStartTimesRef}
								{...{
									experienceId: parseInt(experience.id),
									selectedDate,
									durationType,
									durationValue,
									selectedProducts,
									selectedAddons,
									onLockStateChange: handleLockStateChange,
									onStartTimeSelect: handleStartTimeSelect,
									onBookingReset: handleBookingReset
								}}
								showButton={showMultipleBookingOption || showAvailableTimesButton}
								initialSelectedStartTime={selectedStartTime}
								isLocked={isBookingLocked}
								bookingData={currentBookingData}
								existingReservationGroupId={currentReservationGroupId}
								{totalBookings}
							/>
						{:else}
							<div class="text-center text-sm text-muted-foreground">
								Fyll i alla obligatoriska fält för att se tillgängliga tider
							</div>
						{/if}
					</div>

					<!-- Booking Options Section (shown when booking is completed but navigation UI isn't showing) -->
					{#if showMultipleBookingOption && totalBookings === 1 && !showContactForm && selectedStartTime}
						<div class="mx-auto mt-8 max-w-2xl" bind:this={bookingOptionsSection}>
							<div class="relative rounded-lg border bg-card p-6">
								{#if isResettingBooking}
									<!-- Loading overlay -->
									<div
										class="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm"
									>
										<div class="flex items-center gap-3">
											<svg class="h-6 w-6 animate-spin text-primary" viewBox="0 0 24 24">
												<circle
													class="opacity-25"
													cx="12"
													cy="12"
													r="10"
													stroke="currentColor"
													stroke-width="4"
													fill="none"
												></circle>
												<path
													class="opacity-75"
													fill="currentColor"
													d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
												></path>
											</svg>
											<span class="text-sm font-medium text-gray-700">Återställer bokning...</span>
										</div>
									</div>
								{/if}
								<div class="space-y-4 text-center">
									<h3 class="text-lg font-semibold text-green-700">Bokning slutförd!</h3>
									<p class="text-muted-foreground">
										Din tid är nu reserverad. Vad vill du göra härnäst?
									</p>
									<div class="flex flex-col justify-center gap-4 sm:flex-row">
										<button
											class="rounded-lg border-2 border-primary px-6 py-3 text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
											onclick={addAnotherBooking}
											disabled={isResettingBooking}
										>
											Lägg till en bokning till
										</button>
										<button
											class="rounded-lg bg-primary px-6 py-3 text-white shadow-md transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
											onclick={proceedToContactForm}
											disabled={isResettingBooking}
										>
											Fortsätt till kontaktuppgifter
										</button>
									</div>
								</div>
							</div>
						</div>
					{/if}

					<!-- Booking Options Section for Multiple Bookings (shown at bottom for clean flow) -->
					{#if showMultipleBookingOption && totalBookings > 1 && allBookingsState[currentBookingIndex].isCompleted && allBookingsState[currentBookingIndex].selectedStartTime && !showContactForm}
						<div class="mx-auto mt-8 max-w-2xl">
							<div class="relative rounded-lg border bg-card p-6">
								{#if isResettingBooking}
									<!-- Loading overlay -->
									<div
										class="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm"
									>
										<div class="flex items-center gap-3">
											<svg class="h-6 w-6 animate-spin text-primary" viewBox="0 0 24 24">
												<circle
													class="opacity-25"
													cx="12"
													cy="12"
													r="10"
													stroke="currentColor"
													stroke-width="4"
													fill="none"
												></circle>
												<path
													class="opacity-75"
													fill="currentColor"
													d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
												></path>
											</svg>
											<span class="text-sm font-medium text-gray-700">Återställer bokning...</span>
										</div>
									</div>
								{/if}
								<div class="space-y-4 text-center">
									<h3 class="text-lg font-semibold text-green-700">Bokning slutförd!</h3>
									<p class="text-muted-foreground">
										Du har nu {allBookingsState.filter((b) => b.isCompleted).length} slutförda bokning{allBookingsState.filter(
											(b) => b.isCompleted
										).length === 1
											? ''
											: 'ar'}. Vill du lägga till fler eller fortsätta?
									</p>
									<div class="flex flex-col justify-center gap-4 sm:flex-row">
										<button
											class="rounded-lg border-2 border-primary px-6 py-3 text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
											onclick={addAnotherBooking}
											disabled={isResettingBooking}
										>
											Lägg till en bokning till
										</button>
										<button
											class="rounded-lg bg-primary px-6 py-3 text-white shadow-md transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
											onclick={proceedToContactForm}
											disabled={isResettingBooking}
										>
											Fortsätt till kontaktuppgifter
										</button>
									</div>
								</div>
							</div>
						</div>
					{/if}
				</section>
			{/if}
		{/if}
	{/if}

	{#if showContactForm && allBookingsState.some((b) => b.selectedStartTime)}
		<section class="space-y-4">
			<div class="text-center">
				<h2 class="text-2xl font-semibold">Sammanfattning</h2>
				<p class="text-muted-foreground">
					Du har {allBookingsState.filter((b) => b.isCompleted).length} klar{allBookingsState.filter(
						(b) => b.isCompleted
					).length === 1
						? ''
						: 'a'} bokning{allBookingsState.filter((b) => b.isCompleted).length === 1 ? '' : 'ar'}
				</p>
				<p class="mt-2 text-xl font-semibold">
					Totalt: {formatPrice(displayTotalForAllBookings())}
					<span class="text-sm text-muted-foreground">
						({experience.type === 'private' ? 'inkl. moms' : 'exkl. moms'})
					</span>
				</p>
			</div>
			<ContactForm
				bookings={allBookingsState.filter((b) => b.isCompleted)}
				experienceId={parseInt(experience.id)}
				experienceType={experience.type}
				products={selectedProducts}
				addons={selectedAddons}
				reservationGroupId={currentReservationGroupId}
			/>
		</section>
	{/if}
</div>

<!-- Remove Booking Confirmation Dialog -->
{#if showRemoveConfirmation}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
		<div class="mx-4 max-w-md rounded-lg bg-white p-6 shadow-xl">
			<h3 class="mb-4 text-lg font-semibold text-gray-900">Ta bort bokning?</h3>
			<p class="mb-6 text-gray-600">
				Är du säker på att du vill ta bort denna bokning?
				{#if showRemoveConfirmation.booking.selectedDate && showRemoveConfirmation.booking.selectedStartTime}
					<br /><strong
						>{showRemoveConfirmation.booking.selectedDate.toLocaleDateString('sv-SE')} kl. {showRemoveConfirmation
							.booking.selectedStartTime.startTime}</strong
					>
				{/if}
				<br /><br />
				Denna åtgärd kan inte ångras och tiden kommer att bli tillgänglig för andra att boka.
			</p>
			<div class="flex gap-3">
				<button
					class="flex-1 rounded-lg bg-red-500 px-4 py-2 text-white transition-colors hover:bg-red-600 disabled:opacity-50"
					onclick={() => removeBooking(showRemoveConfirmation!.index)}
					disabled={removingBookingIndex !== null}
				>
					{#if removingBookingIndex === showRemoveConfirmation.index}
						<div class="flex items-center justify-center gap-2">
							<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24">
								<circle
									class="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									stroke-width="4"
									fill="none"
								></circle>
								<path
									class="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
								></path>
							</svg>
							Tar bort...
						</div>
					{:else}
						Ja, ta bort
					{/if}
				</button>
				<button
					class="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
					onclick={() => (showRemoveConfirmation = null)}
					disabled={removingBookingIndex !== null}
				>
					Avbryt
				</button>
			</div>
		</div>
	</div>
{/if}
