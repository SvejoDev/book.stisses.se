<script lang="ts">
	import type { AvailableTime } from '$lib/types/availability';
	import type { SelectedStartTime } from '$lib/types/availability';
	import { cn } from '$lib/utils';
	import { addHours, addDays } from 'date-fns';

	let {
		experienceId,
		selectedDate,
		durationType,
		durationValue,
		selectedProducts = [],
		selectedAddons = [],
		onLockStateChange = () => {},
		onStartTimeSelect = () => {},
		showButton = true,
		initialSelectedStartTime = null,
		isLocked = false,
		// New props for reservation system
		bookingData = null,
		existingBookingNumber = null
	} = $props<{
		experienceId: number;
		selectedDate: Date;
		durationType: string;
		durationValue: number;
		selectedProducts: Array<{ productId: number; quantity: number }>;
		selectedAddons?: Array<{ addonId: number; quantity: number }>;
		onLockStateChange?: (locked: boolean) => void;
		onStartTimeSelect?: (time: { startTime: string; endTime: string }) => void;
		showButton?: boolean;
		initialSelectedStartTime?: { startTime: string; endTime: string } | null;
		isLocked?: boolean;
		// New props for reservation system
		bookingData?: any;
		existingBookingNumber?: string | null;
	}>();

	let isLoading = $state(false);
	let hasAttemptedLoad = $state(false);
	let availableTimes = $state<AvailableTime[]>([]);
	let error = $state<string | null>(null);
	let selectedTime = $state<AvailableTime | null>(null);
	let hasInitialized = $state(false);
	let currentBookingNumber = $state<string | null>(existingBookingNumber);
	let reservationExpiry = $state<Date | null>(null);

	// Debug effect to monitor bookingData prop
	$effect(() => {
		console.log('AvailableStartTimes bookingData prop:', {
			bookingData,
			type: typeof bookingData,
			isNull: bookingData === null,
			isFunction: typeof bookingData === 'function'
		});
	});

	let totalProductQuantity = /** @readonly */ $derived(
		selectedProducts.reduce(
			(sum: number, product: { quantity: number }) => sum + product.quantity,
			0
		)
	);
	let canGenerateTimes = /** @readonly */ $derived(totalProductQuantity > 0);

	// Filter times to show only 30-minute intervals
	let displayTimes = /** @readonly */ $derived(
		availableTimes.filter((time) => {
			const [hours, minutes] = time.startTime.split(':').map(Number);
			return minutes % 30 === 0;
		})
	);

	// Browser close detection for cleanup
	$effect(() => {
		if (typeof window !== 'undefined' && currentBookingNumber) {
			const handleBeforeUnload = () => {
				// Use sendBeacon for reliable cleanup on page unload
				if (navigator.sendBeacon) {
					navigator.sendBeacon(
						'/api/cleanup-expired',
						JSON.stringify({
							bookingNumber: currentBookingNumber
						})
					);
				}
			};

			window.addEventListener('beforeunload', handleBeforeUnload);

			return () => {
				window.removeEventListener('beforeunload', handleBeforeUnload);
			};
		}
	});

	// Periodic cleanup - runs every 1 minute (for development)
	$effect(() => {
		if (typeof window !== 'undefined') {
			const cleanupInterval = setInterval(
				async () => {
					try {
						await fetch('/api/cleanup-expired', { method: 'GET' });
					} catch (error) {
						console.error('Periodic cleanup failed:', error);
					}
				},
				1 * 60 * 1000
			); // 1 minute for development

			return () => {
				clearInterval(cleanupInterval);
			};
		}
	});

	// Monitor addons state changes
	$effect(() => {
		if (selectedAddons?.length > 0) {
		}
	});

	// Auto-load times and set selected time when restoring a previous booking
	$effect(() => {
		if (initialSelectedStartTime && !hasInitialized && canGenerateTimes) {
			hasInitialized = true;
			hasAttemptedLoad = true;
			generateStartTimes().then(() => {
				// After times are loaded, find and set the matching selected time
				const matchingTime = availableTimes.find(
					(time) => time.startTime === initialSelectedStartTime.startTime
				);
				if (matchingTime) {
					selectedTime = matchingTime;
				}
			});
		}
	});

	$effect(() => {
		if (selectedTime) {
			const [hours, minutes] = selectedTime.startTime.split(':').map(Number);
			const startDateTime = new Date(selectedDate);
			startDateTime.setHours(hours, minutes, 0, 0);

			let endDateTime;
			if (durationType === 'hours') {
				endDateTime = addHours(startDateTime, durationValue);
			} else {
				// For overnight bookings, end time is the closing time of the last day
				endDateTime = addDays(startDateTime, durationValue);
				const [endHours, endMinutes] = selectedTime.endTime.split(':').map(Number);
				endDateTime.setHours(endHours, endMinutes, 0, 0);
			}

			// Call onStartTimeSelect with the selected time
			onStartTimeSelect(selectedTime);
		}
	});

	function scrollToBottom() {
		setTimeout(() => {
			window.scrollTo({
				top: document.documentElement.scrollHeight,
				behavior: 'smooth'
			});
		}, 100);
	}

	async function generateStartTimes() {
		try {
			isLoading = true;
			hasAttemptedLoad = true;
			error = null;
			onLockStateChange(true);

			const requestData = {
				date: selectedDate.toISOString().split('T')[0],
				durationType,
				durationValue,
				products: $state.snapshot(selectedProducts),
				addons: $state.snapshot(selectedAddons) || [],
				experienceId
			};

			const response = await fetch('/api/check-availability', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(requestData)
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error('Error response:', errorText);
				throw new Error(`Failed to fetch available times: ${errorText}`);
			}

			const data = await response.json();
			availableTimes = data.availableTimes;

			// Scroll to bottom after times are loaded
			if (data.availableTimes.length > 0) {
				scrollToBottom();
			} else {
				// Also scroll when no times are available
				scrollToBottom();
			}
		} catch (e) {
			console.error('Error in generateStartTimes:', e);
			error = e instanceof Error ? e.message : 'An error occurred';
			onLockStateChange(true);
		} finally {
			isLoading = false;
		}
	}

	async function handleTimeSelect(time: AvailableTime) {
		console.log('handleTimeSelect called with:', {
			time,
			bookingData,
			bookingDataType: typeof bookingData,
			bookingDataKeys: bookingData ? Object.keys(bookingData) : 'null'
		});

		// Handle the case where bookingData is a derived function
		const actualBookingData = typeof bookingData === 'function' ? bookingData() : bookingData;

		console.log('Actual booking data:', {
			actualBookingData,
			type: typeof actualBookingData,
			keys: actualBookingData ? Object.keys(actualBookingData) : 'null'
		});

		if (!actualBookingData) {
			console.error('No booking data available for reservation');
			return;
		}

		try {
			selectedTime = time;

			// Prepare booking data with selected time
			const reservationData = {
				...actualBookingData,
				startTime: time.startTime,
				endTime: time.endTime
			};

			// Debug logging
			console.log('Sending reservation data:', {
				bookingNumber: currentBookingNumber,
				bookingData: reservationData,
				products: reservationData.products,
				addons: reservationData.addons
			});

			// Call reservation API
			const response = await fetch('/api/reserve-availability', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					bookingNumber: currentBookingNumber,
					bookingData: reservationData
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || 'Failed to reserve availability');
			}

			const result = await response.json();
			currentBookingNumber = result.bookingNumber;
			reservationExpiry = new Date(result.expiresAt);

			console.log('Reservation successful:', {
				bookingNumber: result.bookingNumber,
				currentBookingNumber,
				expiresAt: result.expiresAt
			});

			// onStartTimeSelect will be called by the $effect tracking selectedTime
		} catch (error) {
			console.error('Error reserving availability:', error);
			// Reset selected time on error
			selectedTime = null;
			alert('Failed to reserve this time slot. Please try again.');
		}
	}

	function handleReset() {
		hasAttemptedLoad = false;
		availableTimes = [];
		error = null;
		selectedTime = null;
		onLockStateChange(false);
	}

	// Expose booking number for parent components
	export function getBookingNumber() {
		return currentBookingNumber;
	}

	export function getReservationExpiry() {
		return reservationExpiry;
	}
</script>

<div class="space-y-4">
	{#if !hasAttemptedLoad && showButton}
		<button
			class="h-10 w-full rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
			onclick={generateStartTimes}
			disabled={isLoading || !canGenerateTimes}
		>
			{#if isLoading}
				Laddar...
			{:else if !canGenerateTimes}
				Välj minst en produkt
			{:else}
				Nästa steg
			{/if}
		</button>
	{:else if hasAttemptedLoad && showButton}
		<button
			class="h-10 w-full rounded-md border border-primary bg-background px-4 py-2 text-primary hover:bg-primary/10"
			onclick={handleReset}
		>
			Ändra din bokning
		</button>
	{/if}

	{#if error && hasAttemptedLoad}
		<p class="text-sm text-destructive">{error}</p>
	{/if}

	{#if reservationExpiry}
		<div class="rounded-md bg-blue-50 p-3 text-sm text-blue-800">
			<p class="font-medium">Tid reserverad</p>
			<p>
				Din bokning är reserverad till {reservationExpiry.toLocaleTimeString('sv-SE', {
					hour: '2-digit',
					minute: '2-digit'
				})} (2 minuter)
			</p>
		</div>
	{/if}

	{#if availableTimes.length > 0}
		<div class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
			{#each displayTimes as time}
				<button
					class={cn(
						'inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
						selectedTime === time && 'bg-primary text-primary-foreground hover:bg-primary/90'
					)}
					onclick={() => handleTimeSelect(time)}
				>
					{time.startTime}
				</button>
			{/each}
		</div>
	{:else if !isLoading && !error && hasAttemptedLoad}
		<div class="space-y-2 text-center">
			<p class="font-medium text-destructive">Inga tillgängliga tider hittades</p>
			<p class="text-sm text-muted-foreground">Vänligen prova att:</p>
			<ul class="list-inside list-disc text-sm text-muted-foreground">
				<li>Välja ett annat datum</li>
				<li>Ändra antalet produkter</li>
				<li>Justera bokningslängden</li>
			</ul>
		</div>
	{/if}
</div>

<style>
	button {
		transition: all 0.2s ease-in-out;
	}

	button:hover {
		transform: scale(1.02);
	}
</style>
