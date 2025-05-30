<script lang="ts">
	import type { AvailableTime } from '$lib/types/availability';
	import type { SelectedStartTime } from '$lib/types/availability';
	import { cn } from '$lib/utils';
	import { addHours, addDays } from 'date-fns';
	import { supabase } from '$lib/supabaseClient';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';

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
	let isSelectingTime = $state(false); // New loading state for time selection
	let hasAttemptedLoad = $state(false);
	let availableTimes = $state<AvailableTime[]>([]);
	let error = $state<string | null>(null);
	let selectedTime = $state<AvailableTime | null>(null);
	let hasInitialized = $state(false);
	let currentReservationGroupId = $state<string | null>(existingReservationGroupId);
	let currentBookingNumber = $state<string | null>(null);
	let reservationExpiry = $state<Date | null>(null);
	let reservationCheckInterval: NodeJS.Timeout | null = null;
	let countdownInterval: NodeJS.Timeout | null = null;
	let timeRemaining = $state<{ minutes: number; seconds: number } | null>(null);
	let editingBooking = $state<{
		bookingNumber: string;
		startTime: string;
		endTime: string;
		startDate: string;
	} | null>(null);
	let currentBookingsInGroup = $state<
		Array<{
			bookingNumber: string;
			startTime: string;
			endTime: string;
			startDate: string;
			isCurrentBooking: boolean;
		}>
	>([]);

	// Single effect to handle reservation group ID initialization and synchronization
	$effect(() => {
		// Only update if we have an existingReservationGroupId and it's different from current
		if (existingReservationGroupId && existingReservationGroupId !== currentReservationGroupId) {
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

	// Function to calculate time remaining
	function calculateTimeRemaining(expiryDate: Date): { minutes: number; seconds: number } | null {
		const now = new Date();
		const diff = expiryDate.getTime() - now.getTime();

		if (diff <= 0) {
			return null;
		}

		const minutes = Math.floor(diff / (1000 * 60));
		const seconds = Math.floor((diff % (1000 * 60)) / 1000);

		return { minutes, seconds };
	}

	// Function to start countdown timer
	function startCountdownTimer() {
		if (countdownInterval) {
			clearInterval(countdownInterval);
		}

		if (!reservationExpiry) {
			timeRemaining = null;
			return;
		}

		// Update immediately
		timeRemaining = calculateTimeRemaining(reservationExpiry);

		// Update every second
		countdownInterval = setInterval(() => {
			if (!reservationExpiry) {
				timeRemaining = null;
				return;
			}

			timeRemaining = calculateTimeRemaining(reservationExpiry);

			// If time expired, handle it
			if (!timeRemaining) {
				handleReservationExpired();
			}
		}, 1000);
	}

	// Simplified reservation monitoring with countdown
	$effect(() => {
		if (reservationExpiry && currentBookingNumber) {
			// Start the countdown timer
			startCountdownTimer();

			// Cleanup function
			return () => {
				if (countdownInterval) {
					clearInterval(countdownInterval);
					countdownInterval = null;
				}
			};
		} else {
			// Clear countdown if no reservation
			if (countdownInterval) {
				clearInterval(countdownInterval);
				countdownInterval = null;
			}
			timeRemaining = null;
		}
	});

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

	// Periodic cleanup - runs every 30 seconds to clean up expired reservations
	$effect(() => {
		if (typeof window !== 'undefined') {
			const cleanupInterval = setInterval(
				async () => {
					try {
						// Only clean up expired reservations, not those with session_id (in payment)
						await fetch('/api/cleanup-expired', { method: 'GET' });
					} catch (error) {
						console.error('Periodic cleanup failed:', error);
					}
				},
				30 * 1000 // Every 30 seconds
			);

			return () => {
				clearInterval(cleanupInterval);
			};
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

		// Redirect to start page to fully reset everything
		window.location.href = window.location.pathname;
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
		// Prevent spam clicking
		if (isSelectingTime) {
			return;
		}

		isSelectingTime = true;

		try {
			// Handle the case where bookingData is a derived function
			const actualBookingData = typeof bookingData === 'function' ? bookingData() : bookingData;

			if (!actualBookingData) {
				console.error('No booking data available for reservation');
				return;
			}

			// Check if user is changing their existing selection (use atomic update)
			const isEditingExistingBooking =
				(currentBookingNumber && selectedTime && selectedTime.startTime !== time.startTime) ||
				editingBooking;

			if (isEditingExistingBooking) {
				const bookingToUpdate = editingBooking || {
					bookingNumber: currentBookingNumber!,
					startTime: selectedTime!.startTime,
					endTime: selectedTime!.endTime,
					startDate: actualBookingData.startDate
				};

				// Use atomic update endpoint
				const response = await fetch('/api/update-reservation-time', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						reservationGroupId: currentReservationGroupId,
						bookingNumber: bookingToUpdate.bookingNumber,
						newStartTime: time.startTime,
						newEndTime: time.endTime,
						bookingData: {
							experienceId: actualBookingData.experienceId,
							startLocationId: actualBookingData.startLocationId,
							durationId: actualBookingData.durationId,
							startDate: bookingToUpdate.startDate,
							products: actualBookingData.products,
							addons: actualBookingData.addons
						}
					})
				});

				if (!response.ok) {
					const errorData = await response.json();
					throw new Error(errorData.error || 'Failed to update reservation time');
				}

				const result = await response.json();

				// Update local state with new time and extended expiry
				selectedTime = time;
				reservationExpiry = new Date(result.expiresAt);

				// If we were editing a previous booking, clear that state and refresh bookings
				if (editingBooking) {
					editingBooking = null;
					await fetchCurrentBookings(); // Refresh the bookings list
				}

				// Notify parent of successful time change
				onStartTimeSelect(selectedTime);
			} else {
				// First time selection or new booking - use regular reservation flow

				// Set the selected time
				selectedTime = time;

				// Prepare booking data with selected time
				const reservationData = {
					...actualBookingData,
					startTime: time.startTime,
					endTime: time.endTime
				};

				// Use existing reservation group ID if available, otherwise let API create new one
				const reservationGroupIdToUse = currentReservationGroupId || existingReservationGroupId;

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

				if (!response.ok) {
					const errorData = await response.json();
					throw new Error(errorData.error || 'Failed to reserve availability');
				}

				const result = await response.json();

				// Update all state at once
				currentReservationGroupId = result.reservationGroupId;
				currentBookingNumber = result.bookingNumber;
				reservationExpiry = new Date(result.expiresAt);

				// Call onStartTimeSelect after successful reservation
				onStartTimeSelect(selectedTime);
			}
		} catch (error) {
			console.error('Error in handleTimeSelect:', error);
			// Reset selected time on error
			selectedTime = null;

			// Show user-friendly error message
			const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
			alert(`Failed to reserve this time slot: ${errorMessage}. Please try again.`);
		} finally {
			// Always reset loading state
			isSelectingTime = false;
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

	// Function to fetch current bookings in the reservation group
	async function fetchCurrentBookings() {
		if (!currentReservationGroupId) {
			currentBookingsInGroup = [];
			return;
		}

		try {
			const { data: bookings, error } = await supabase
				.from('pending_bookings')
				.select('booking_number, booking_data')
				.eq('reservation_group_id', currentReservationGroupId)
				.eq('availability_reserved', true);

			if (error) {
				console.error('Error fetching current bookings:', error);
				return;
			}

			currentBookingsInGroup =
				bookings?.map((booking) => ({
					bookingNumber: booking.booking_number,
					startTime: booking.booking_data[0].startTime,
					endTime: booking.booking_data[0].endTime,
					startDate: booking.booking_data[0].startDate,
					isCurrentBooking: booking.booking_number === currentBookingNumber
				})) || [];
		} catch (error) {
			console.error('Error fetching bookings:', error);
			currentBookingsInGroup = [];
		}
	}

	// Effect to fetch bookings when reservation group changes
	$effect(() => {
		if (currentReservationGroupId) {
			fetchCurrentBookings();
		} else {
			currentBookingsInGroup = [];
		}
	});

	// Function to handle changing time for a previous booking
	async function handleChangeBookingTime(booking: {
		bookingNumber: string;
		startTime: string;
		endTime: string;
		startDate: string;
		isCurrentBooking: boolean;
	}) {
		if (isSelectingTime) return;

		console.log('🔄 Starting time change for previous booking:', booking);

		// Set this booking as the one being edited
		editingBooking = {
			bookingNumber: booking.bookingNumber,
			startTime: booking.startTime,
			endTime: booking.endTime,
			startDate: booking.startDate
		};

		// Clear current selection state to show available times
		selectedTime = null;

		// Regenerate available times for this booking's date
		// Note: The date should already be selected, but we might need to refresh times
		if (hasAttemptedLoad) {
			try {
				await generateStartTimes();
			} catch (error) {
				console.error('Error regenerating times for booking edit:', error);
				alert('Kunde inte ladda tillgängliga tider. Försök igen.');
				editingBooking = null;
			}
		}
	}

	// Function to cancel editing a previous booking
	function cancelEditingBooking() {
		editingBooking = null;
		selectedTime = null;
	}

	// Export function to get the number of current bookings (useful for parent components)
	export function getCurrentBookingCount() {
		return currentBookingsInGroup.length;
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
			<div class="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 sm:h-8 sm:w-8">
				<svg
					class="h-3 w-3 text-green-600 sm:h-4 sm:w-4"
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
					{#if timeRemaining}
						<span class="text-green-600"
							>{timeRemaining.minutes}:{timeRemaining.seconds.toString().padStart(2, '0')}</span
						>
					{:else}
						<span class="text-green-600">Reserverad</span>
					{/if}
				</p>
			</div>
		</div>
	</div>
{/if}

<!-- Current bookings in reservation group -->
{#if currentBookingsInGroup.length > 1}
	<div class="mb-6 space-y-3">
		<h3 class="text-center text-lg font-semibold">Dina nuvarande bokningar</h3>
		{#if editingBooking}
			<div class="rounded-lg border-2 border-blue-200 bg-blue-50 p-3">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<span class="text-sm font-medium text-blue-700">
							Ändrar tid för: {editingBooking.startTime} - {editingBooking.endTime}
						</span>
					</div>
					<Button variant="outline" size="sm" onclick={cancelEditingBooking}>Avbryt</Button>
				</div>
			</div>
		{/if}
		<div class="space-y-2">
			{#each currentBookingsInGroup as booking}
				<Card.Root
					class={cn(
						'p-4',
						booking.isCurrentBooking && 'border-primary bg-primary/5',
						editingBooking?.bookingNumber === booking.bookingNumber && 'border-blue-300 bg-blue-50'
					)}
				>
					<Card.Content class="p-0">
						<div class="flex items-center justify-between">
							<div class="space-y-1">
								<div class="flex items-center gap-2">
									<p class="text-sm font-medium">
										{booking.startTime} - {booking.endTime}
									</p>
									{#if booking.isCurrentBooking}
										<span
											class="inline-flex items-center rounded-full bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
										>
											Aktuell
										</span>
									{:else if editingBooking?.bookingNumber === booking.bookingNumber}
										<span
											class="inline-flex items-center rounded-full bg-blue-600 px-2 py-1 text-xs font-medium text-white"
										>
											Redigeras
										</span>
									{/if}
								</div>
								<p class="text-xs text-muted-foreground">
									{new Date(booking.startDate).toLocaleDateString('sv-SE', {
										weekday: 'short',
										year: 'numeric',
										month: 'short',
										day: 'numeric'
									})}
								</p>
							</div>
							{#if !booking.isCurrentBooking && !editingBooking}
								<Button
									variant="outline"
									size="sm"
									onclick={() => handleChangeBookingTime(booking)}
									disabled={isSelectingTime}
								>
									Ändra tid
								</Button>
							{/if}
						</div>
					</Card.Content>
				</Card.Root>
			{/each}
		</div>
	</div>
{/if}

<div class="space-y-4">
	{#if !hasAttemptedLoad && showButton}
		<button
			class="h-10 w-full rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
			onclick={generateStartTimes}
			disabled={isLoading || !canGenerateTimes || isSelectingTime}
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
			class="h-10 w-full rounded-md border border-primary bg-background px-4 py-2 text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
			onclick={handleReset}
			disabled={isSelectingTime}
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
					disabled={isSelectingTime}
				>
					{#if isSelectingTime && selectedTime === time}
						<svg class="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24">
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
					{/if}
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
