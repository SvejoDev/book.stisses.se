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
		onBookingReset = () => {},
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
		onBookingReset?: () => void;
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
	let isResetting = $state(false); // New loading state for reset process
	let hasAttemptedLoad = $state(false);
	let availableTimes = $state<AvailableTime[]>([]);
	let error = $state<string | null>(null);
	let selectedTime = $state<AvailableTime | null>(null);
	let hasInitialized = $state(false);
	let currentReservationGroupId = $state<string | null>(existingReservationGroupId);
	let currentBookingNumber = $state<string | null>(null);
	let reservationExpiry = $state<Date | null>(null);
	let originalReservationExpiry = $state<Date | null>(null); // Track the original timer from first booking
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
		} else if (existingReservationGroupId === null && currentReservationGroupId !== null) {
			// Reset to null if parent component cleared the reservation group ID
			currentReservationGroupId = null;
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

	// Function to calculate time remaining - always use original timer
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

	// Function to start countdown timer - always use original expiry
	function startCountdownTimer() {
		if (countdownInterval) {
			clearInterval(countdownInterval);
		}

		// Use original expiry for timer display, but fall back to current if not set
		const timerExpiry = originalReservationExpiry || reservationExpiry;

		if (!timerExpiry) {
			timeRemaining = null;
			return;
		}

		// Update immediately
		timeRemaining = calculateTimeRemaining(timerExpiry);

		// Update every second
		countdownInterval = setInterval(() => {
			const currentTimerExpiry = originalReservationExpiry || reservationExpiry;
			if (!currentTimerExpiry) {
				timeRemaining = null;
				return;
			}

			timeRemaining = calculateTimeRemaining(currentTimerExpiry);

			// If time expired, handle it
			if (!timeRemaining) {
				handleReservationExpired();
			}
		}, 1000);
	}

	// Simplified reservation monitoring with countdown - preserve original timer
	$effect(() => {
		// Show timer if we have any reservation expiry, prioritizing original
		// This allows timer to persist across multiple bookings in the same reservation group
		const hasTimer =
			originalReservationExpiry ||
			(reservationExpiry &&
				(currentBookingNumber || currentReservationGroupId || currentBookingsInGroup.length > 0));

		if (hasTimer) {
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

	// Browser close detection for cleanup - Enhanced with multiple strategies
	$effect(() => {
		if (typeof window !== 'undefined' && currentBookingNumber) {
			const cleanup = () => {
				// Use sendBeacon for reliable cleanup on page unload
				if (navigator.sendBeacon) {
					navigator.sendBeacon(
						'/api/cleanup-expired',
						JSON.stringify({
							bookingNumber: currentBookingNumber
						})
					);
				} else {
					// Fallback for browsers that don't support sendBeacon
					fetch('/api/cleanup-expired', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ bookingNumber: currentBookingNumber }),
						keepalive: true
					}).catch(() => {
						// Ignore errors in cleanup
					});
				}
			};

			// Only use critical unload events - removed visibilitychange as it's too aggressive
			const events = ['beforeunload', 'unload', 'pagehide'];
			events.forEach((event) => {
				window.addEventListener(event, cleanup);
			});

			return () => {
				events.forEach((event) => {
					window.removeEventListener(event, cleanup);
				});
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

	async function handleReservationExpired() {
		console.log('⏰ Reservation expired, cleaning up...');

		// Store the booking number before clearing state
		const bookingNumberToCleanup = currentBookingNumber;

		// Reset all reservation-related state immediately
		currentBookingNumber = null;
		reservationExpiry = null;
		originalReservationExpiry = null; // Clear original timer on expiry
		selectedTime = null;

		// Clear the interval
		if (reservationCheckInterval) {
			clearInterval(reservationCheckInterval);
			reservationCheckInterval = null;
		}

		// Clear countdown timer
		if (countdownInterval) {
			clearInterval(countdownInterval);
			countdownInterval = null;
		}
		timeRemaining = null;

		// Call cleanup API directly instead of relying on page refresh
		if (bookingNumberToCleanup) {
			try {
				console.log('🧹 Calling cleanup API for expired booking:', bookingNumberToCleanup);

				const response = await fetch('/api/cleanup-expired', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						bookingNumber: bookingNumberToCleanup
					})
				});

				if (response.ok) {
					console.log('✅ Successfully cleaned up expired booking');
				} else {
					console.error('❌ Failed to cleanup expired booking:', response.status);
				}
			} catch (error) {
				console.error('❌ Error during cleanup of expired booking:', error);
				// Even if cleanup fails, continue with UI reset
			}
		}

		// Show user-friendly notification
		alert('Din reserverade tid har gått ut. Du kan nu göra en ny bokning.');

		// Reset UI state gracefully without page refresh
		onLockStateChange(false);
		onBookingReset();

		// Reset component state
		hasAttemptedLoad = false;
		availableTimes = [];
		error = null;

		// Clear reservation group if this was the only booking
		if (currentReservationGroupId) {
			try {
				const { data: otherBookings } = await supabase
					.from('pending_bookings')
					.select('booking_number')
					.eq('reservation_group_id', currentReservationGroupId)
					.eq('availability_reserved', true);

				if (!otherBookings || otherBookings.length === 0) {
					currentReservationGroupId = null;
					currentBookingsInGroup = [];
				}
			} catch (error) {
				console.error('Error checking other bookings during expiry:', error);
				// On error, clear everything to be safe
				currentReservationGroupId = null;
				currentBookingsInGroup = [];
			}
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

				// Don't update original expiry when editing - preserve the original timer
				if (!originalReservationExpiry) {
					originalReservationExpiry = new Date(result.expiresAt);
				}

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
				// If currentReservationGroupId is null, start fresh
				const reservationGroupIdToUse = currentReservationGroupId || existingReservationGroupId;

				console.log('Making reservation API call:', {
					hasReservationGroupId: !!reservationGroupIdToUse,
					reservationGroupId: reservationGroupIdToUse,
					isExtendingExisting: !!reservationGroupIdToUse
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

				if (!response.ok) {
					const errorText = await response.text();
					console.error('Reservation API error:', {
						status: response.status,
						statusText: response.statusText,
						errorText
					});

					// If extending an existing reservation failed, try creating a new one
					if (response.status === 404 && reservationGroupIdToUse) {
						console.log('Existing reservation not found, creating new reservation group');

						// Reset reservation group ID and try again without it
						currentReservationGroupId = null;

						const retryResponse = await fetch('/api/reserve-availability', {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json'
							},
							body: JSON.stringify({
								reservationGroupId: null,
								bookingData: reservationData
							})
						});

						if (!retryResponse.ok) {
							const retryErrorText = await retryResponse.text();
							throw new Error(`Failed to create new reservation: ${retryErrorText}`);
						}

						const retryResult = await retryResponse.json();

						// Update all state with the new reservation group
						currentReservationGroupId = retryResult.reservationGroupId;
						currentBookingNumber = retryResult.bookingNumber;
						reservationExpiry = new Date(retryResult.expiresAt);

						// Set original expiry only if this is the first booking
						if (!originalReservationExpiry) {
							originalReservationExpiry = new Date(retryResult.expiresAt);
						}

						// Call onStartTimeSelect after successful reservation
						onStartTimeSelect(selectedTime);
						return;
					}

					throw new Error(`Failed to reserve availability: ${errorText}`);
				}

				const result = await response.json();

				// Update all state at once
				currentReservationGroupId = result.reservationGroupId;
				currentBookingNumber = result.bookingNumber;
				reservationExpiry = new Date(result.expiresAt);

				// Set original expiry only if this is the first booking in the group
				if (!originalReservationExpiry) {
					originalReservationExpiry = new Date(result.expiresAt);
				}

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

	async function handleReset() {
		// Set loading state
		isResetting = true;

		try {
			// If user has made a reservation, clean it up first
			if (currentBookingNumber) {
				try {
					console.log('🧹 Cleaning up current booking before reset:', currentBookingNumber);

					const response = await fetch('/api/cleanup-expired', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json'
						},
						body: JSON.stringify({
							bookingNumber: currentBookingNumber
						})
					});

					if (!response.ok) {
						console.error('Failed to cleanup booking during reset');
						// Continue with reset even if cleanup fails
					} else {
						console.log('✅ Successfully cleaned up booking during reset');
					}
				} catch (error) {
					console.error('Error during cleanup in reset:', error);
					// Continue with reset even if cleanup fails
				}
			}

			// Reset UI state
			hasAttemptedLoad = false;
			availableTimes = [];
			error = null;
			selectedTime = null;

			// Clear current booking state but preserve reservation group for multi-booking
			const hadReservationGroup = !!currentReservationGroupId;
			currentBookingNumber = null;
			reservationExpiry = null;
			// Keep originalReservationExpiry to maintain timer across bookings

			// Clear timers
			if (reservationCheckInterval) {
				clearInterval(reservationCheckInterval);
				reservationCheckInterval = null;
			}
			if (countdownInterval) {
				clearInterval(countdownInterval);
				countdownInterval = null;
			}
			timeRemaining = null;

			// For multi-booking scenarios, check if there are other bookings in the group
			if (hadReservationGroup && currentReservationGroupId) {
				try {
					const { data: otherBookings } = await supabase
						.from('pending_bookings')
						.select('booking_number')
						.eq('reservation_group_id', currentReservationGroupId)
						.eq('availability_reserved', true);

					// If no other bookings exist, clear the reservation group and timer
					if (!otherBookings || otherBookings.length === 0) {
						console.log('🔄 No other bookings in group, clearing reservation group ID and timer');
						currentReservationGroupId = null;
						currentBookingsInGroup = [];
						originalReservationExpiry = null; // Clear original timer when no bookings remain
					} else {
						console.log(
							`🔄 ${otherBookings.length} other bookings remain in group, keeping reservation group ID and timer`
						);
						// Refresh the bookings list
						await fetchCurrentBookings();
					}
				} catch (error) {
					console.error('Error checking other bookings during reset:', error);
					// On error, clear everything to be safe
					currentReservationGroupId = null;
					currentBookingsInGroup = [];
					originalReservationExpiry = null;
				}
			} else {
				// Single booking scenario - clear everything including timer
				currentReservationGroupId = null;
				currentBookingsInGroup = [];
				originalReservationExpiry = null;
			}

			onLockStateChange(false);
			onBookingReset();
		} finally {
			// Always clear loading state
			isResetting = false;
		}
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
				.select('booking_number, booking_data, expires_at')
				.eq('reservation_group_id', currentReservationGroupId)
				.eq('availability_reserved', true);

			if (error) {
				console.error('Error fetching current bookings:', error);
				return;
			}

			// If we don't have a current reservation expiry, get it from any booking in the group
			if (!reservationExpiry && bookings && bookings.length > 0) {
				reservationExpiry = new Date(bookings[0].expires_at);
				console.log('📅 Restored reservation expiry from existing booking:', reservationExpiry);
			}

			// If we don't have an original expiry but have bookings, set it to preserve timer
			if (!originalReservationExpiry && bookings && bookings.length > 0) {
				originalReservationExpiry = new Date(bookings[0].expires_at);
				console.log(
					'📅 Set original reservation expiry from existing booking:',
					originalReservationExpiry
				);
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
			// Clear reservation expiry if no reservation group, but keep original timer
			if (!currentBookingNumber) {
				reservationExpiry = null;
				// Only clear original timer if no reservation group exists
				if (!currentReservationGroupId) {
					originalReservationExpiry = null;
				}
			}
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
		return originalReservationExpiry || reservationExpiry;
	}

	// Export function to check if component is resetting
	export function isResettingBooking() {
		return isResetting;
	}
</script>

<!-- Timer is now managed by parent component, so we hide it here to avoid duplication -->

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
			disabled={isLoading || !canGenerateTimes || isSelectingTime || isResetting}
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
			disabled={isSelectingTime || isResetting}
		>
			{#if isResetting}
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
					Återställer...
				</div>
			{:else}
				Ändra din bokning
			{/if}
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
	{:else if selectedTime && hasAttemptedLoad}
		<!-- Show selected time when no available times are displayed -->
		<div class="space-y-4">
			<div class="rounded-lg border-2 border-green-200 bg-green-50 p-4">
				<div class="flex items-center justify-center gap-3">
					<div class="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
						<svg
							class="h-4 w-4 text-green-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M5 13l4 4L19 7"
							></path>
						</svg>
					</div>
					<div class="text-center">
						<p class="text-sm font-medium text-green-700">Vald tid</p>
						{#if durationType === 'overnights'}
							<!-- Multi-day booking: show start date + time and end date + time -->
							{@const startDate = selectedDate}
							{@const endDate = addDays(startDate, durationValue)}
							<div class="space-y-1">
								<p class="text-lg font-semibold text-green-900">
									{startDate.toLocaleDateString('sv-SE', {
										weekday: 'short',
										day: 'numeric',
										month: 'short'
									})} kl. {selectedTime.startTime}
								</p>
								<p class="text-sm text-green-700">till</p>
								<p class="text-lg font-semibold text-green-900">
									{endDate.toLocaleDateString('sv-SE', {
										weekday: 'short',
										day: 'numeric',
										month: 'short'
									})} kl. {selectedTime.endTime}
								</p>
							</div>
						{:else}
							<!-- Same-day booking: show date with start and end time -->
							<div class="space-y-1">
								<p class="text-lg font-semibold text-green-900">
									{selectedDate.toLocaleDateString('sv-SE', {
										weekday: 'short',
										day: 'numeric',
										month: 'short'
									})}
								</p>
								<p class="text-lg font-semibold text-green-900">
									{selectedTime.startTime} - {selectedTime.endTime}
								</p>
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{:else if !isLoading && !error && hasAttemptedLoad && !selectedTime}
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
