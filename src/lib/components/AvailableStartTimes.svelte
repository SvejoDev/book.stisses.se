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
		existingReservationGroupId = null,
		totalBookings = 1
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
		existingReservationGroupId?: string | null;
		totalBookings?: number;
	}>();

	let isLoading = $state(false);
	let hasAttemptedLoad = $state(false);
	let availableTimes = $state<AvailableTime[]>([]);
	let error = $state<string | null>(null);
	let selectedTime = $state<AvailableTime | null>(null);
	let hasInitialized = $state(false);
	let currentReservationGroupId = $state<string | null>(existingReservationGroupId);
	let currentBookingNumber = $state<string | null>(null);
	let reservationExpiry = $state<Date | null>(null);
	let reservationCheckInterval: NodeJS.Timeout | null = null;

	// Single effect to handle reservation group ID initialization and synchronization
	$effect(() => {
		console.log('🔄 EFFECT 1 - Reservation Group Sync:', {
			existingReservationGroupId,
			currentReservationGroupId,
			willUpdate:
				existingReservationGroupId && existingReservationGroupId !== currentReservationGroupId,
			timestamp: Date.now()
		});

		// Only update if we have an existingReservationGroupId and it's different from current
		if (existingReservationGroupId && existingReservationGroupId !== currentReservationGroupId) {
			console.log('🔄 EFFECT 1 - UPDATING currentReservationGroupId:', {
				from: currentReservationGroupId,
				to: existingReservationGroupId,
				reason: currentReservationGroupId ? 'update' : 'initialize'
			});
			currentReservationGroupId = existingReservationGroupId;
		}
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

	// Simplified reservation monitoring - no countdown to prevent infinite loops
	$effect(() => {
		console.log('🔄 EFFECT 2 - Reservation Expiry Monitor:', {
			hasReservationExpiry: !!reservationExpiry,
			hasCurrentBookingNumber: !!currentBookingNumber,
			willSetInterval: !!(reservationExpiry && currentBookingNumber),
			timestamp: Date.now()
		});

		if (reservationExpiry && currentBookingNumber) {
			// Clear any existing interval
			if (reservationCheckInterval) {
				clearInterval(reservationCheckInterval);
				reservationCheckInterval = null;
			}

			// Simple check every 30 seconds to see if reservation expired
			reservationCheckInterval = setInterval(() => {
				if (!reservationExpiry) return;

				const now = new Date();
				if (now >= reservationExpiry) {
					console.log('Reservation has expired, resetting UI');
					handleReservationExpired();
				}
			}, 30000); // Check every 30 seconds

			// Cleanup function
			return () => {
				if (reservationCheckInterval) {
					clearInterval(reservationCheckInterval);
					reservationCheckInterval = null;
				}
			};
		} else {
			// Clear interval if no reservation
			if (reservationCheckInterval) {
				clearInterval(reservationCheckInterval);
				reservationCheckInterval = null;
			}
		}
	});

	// Browser close detection for cleanup
	$effect(() => {
		console.log('🔄 EFFECT 3 - Browser Cleanup:', {
			isWindow: typeof window !== 'undefined',
			hasCurrentBookingNumber: !!currentBookingNumber,
			willAddListener: typeof window !== 'undefined' && !!currentBookingNumber,
			timestamp: Date.now()
		});

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
	// DISABLED: This was causing bookings to be deleted too aggressively during development
	/*
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
	*/

	// Auto-load times and set selected time when restoring a previous booking
	$effect(() => {
		console.log('🔄 EFFECT 4 - Auto-load Previous Booking:', {
			hasInitialSelectedStartTime: !!initialSelectedStartTime,
			hasInitialized,
			canGenerateTimes,
			willExecute: !!(initialSelectedStartTime && !hasInitialized && canGenerateTimes),
			timestamp: Date.now()
		});

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
					// Call onStartTimeSelect when restoring a previous booking
					onStartTimeSelect(matchingTime);
				}
			});
		}
	});

	function handleReservationExpired() {
		// Reset all reservation-related state
		currentBookingNumber = null;
		reservationExpiry = null;
		selectedTime = null;

		// Clear the interval
		if (reservationCheckInterval) {
			clearInterval(reservationCheckInterval);
			reservationCheckInterval = null;
		}

		// Unlock the booking form
		onLockStateChange(false);

		// Show a message to the user
		alert('Din reservation har gått ut. Vänligen välj en ny tid.');

		// Optionally reload available times to show current availability
		if (hasAttemptedLoad) {
			generateStartTimes();
		}
	}

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
		console.log('🎯 handleTimeSelect START:', {
			time: time.startTime,
			currentState: {
				selectedTime: selectedTime?.startTime || null,
				currentReservationGroupId,
				currentBookingNumber,
				reservationExpiry: !!reservationExpiry
			},
			timestamp: Date.now()
		});

		console.log('handleTimeSelect called with:', {
			time,
			bookingData,
			bookingDataType: typeof bookingData,
			bookingDataKeys: bookingData ? Object.keys(bookingData) : 'null',
			currentReservationGroupId,
			existingReservationGroupId,
			willExtendExisting: !!currentReservationGroupId
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
			console.log('🎯 Setting selectedTime to:', time.startTime);
			selectedTime = time;

			// Prepare booking data with selected time
			const reservationData = {
				...actualBookingData,
				startTime: time.startTime,
				endTime: time.endTime
			};

			// Use existing reservation group ID if available, otherwise let API create new one
			const reservationGroupIdToUse = currentReservationGroupId || existingReservationGroupId;

			// Debug logging
			console.log('Sending reservation data:', {
				reservationGroupId: reservationGroupIdToUse,
				bookingData: reservationData,
				products: reservationData.products,
				addons: reservationData.addons,
				willExtendExisting: !!reservationGroupIdToUse,
				source: currentReservationGroupId
					? 'currentReservationGroupId'
					: existingReservationGroupId
						? 'existingReservationGroupId'
						: 'new'
			});

			// Call reservation API
			const response = await fetch('/api/reserve-availability', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					reservationGroupId: reservationGroupIdToUse,
					bookingData: reservationData
				})
			});

			console.log('Reserve availability API call:', {
				url: '/api/reserve-availability',
				method: 'POST',
				reservationGroupId: reservationGroupIdToUse,
				existingReservationGroupId,
				totalBookings,
				isExtendingExisting: !!reservationGroupIdToUse
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || 'Failed to reserve availability');
			}

			const result = await response.json();
			console.log('🎯 Setting reservation state:', {
				reservationGroupId: result.reservationGroupId,
				bookingNumber: result.bookingNumber,
				expiresAt: result.expiresAt
			});

			currentReservationGroupId = result.reservationGroupId;
			console.log('🎯 Set currentReservationGroupId to:', currentReservationGroupId);

			currentBookingNumber = result.bookingNumber;
			console.log('🎯 Set currentBookingNumber to:', currentBookingNumber);

			reservationExpiry = new Date(result.expiresAt);
			console.log('🎯 Set reservationExpiry to:', reservationExpiry);

			console.log('Reservation successful:', {
				reservationGroupId: result.reservationGroupId,
				bookingNumber: result.bookingNumber,
				currentReservationGroupId,
				currentBookingNumber,
				expiresAt: result.expiresAt
			});

			// Call onStartTimeSelect directly after successful reservation
			console.log('🎯 Calling onStartTimeSelect with:', selectedTime);
			onStartTimeSelect(selectedTime);
			console.log('🎯 onStartTimeSelect completed');
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

		// Clear reservation state
		currentReservationGroupId = null;
		currentBookingNumber = null;
		reservationExpiry = null;
		if (reservationCheckInterval) {
			clearInterval(reservationCheckInterval);
			reservationCheckInterval = null;
		}

		onLockStateChange(false);
	}

	// Expose reservation group ID for parent components
	export function getReservationGroupId() {
		return currentReservationGroupId;
	}

	export function getBookingNumber() {
		return currentBookingNumber;
	}

	export function getReservationExpiry() {
		return reservationExpiry;
	}
</script>

<!-- Fixed reservation timer -->
{#if reservationExpiry}
	<div
		class="fixed right-4 top-4 z-50 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg sm:px-4 sm:py-3"
	>
		<div class="flex items-center gap-2 sm:gap-3">
			<div class="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 sm:h-8 sm:w-8">
				<svg
					class="h-3 w-3 text-gray-600 sm:h-4 sm:w-4"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
					></path>
				</svg>
			</div>
			<div>
				<p class="text-xs font-medium text-gray-600 sm:text-sm">
					{#if totalBookings > 1}
						Reserverad tid ({totalBookings} bokningar)
					{:else}
						Reserverad tid
					{/if}
				</p>
				<p class="font-mono text-sm font-semibold text-gray-900 sm:text-base">
					<span class="text-green-600">Reserverad</span>
				</p>
			</div>
		</div>
	</div>
{/if}

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
