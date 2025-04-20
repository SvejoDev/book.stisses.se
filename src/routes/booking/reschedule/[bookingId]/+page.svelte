<script lang="ts">
	import { onMount } from 'svelte';
	import Calendar from '$lib/components/Calendar.svelte';
	import AvailableStartTimes from '$lib/components/AvailableStartTimes.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	let { data } = $props<{
		data: {
			openDates: any[];
			blockedDates: any[];
		};
	}>();

	let bookingId = $derived($page.params.bookingId);
	let booking = $state<any>(null);
	let error = $state<string | null>(null);
	let selectedDate = $state<Date | null>(null);
	let selectedStartTime = $state<{ startTime: string; endTime: string } | null>(null);
	let isLoading = $state(false);
	let isRescheduling = $state(false);

	$effect(() => {
		if (bookingId) {
			loadBooking();
		}
	});

	async function loadBooking() {
		try {
			isLoading = true;
			const response = await fetch(`/api/reschedule/${bookingId}`);
			const data = await response.json();

			if (!response.ok) {
				error = data.error;
				return;
			}

			booking = data.booking;
		} catch (e) {
			error = 'Failed to load booking details';
			console.error('Error loading booking:', e);
		} finally {
			isLoading = false;
		}
	}

	async function handleReschedule() {
		if (!selectedDate || !selectedStartTime) return;

		try {
			isRescheduling = true;
			const response = await fetch('/api/reschedule', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					bookingId,
					newDate: selectedDate.toISOString().split('T')[0],
					newStartTime: selectedStartTime.startTime,
					newEndTime: selectedStartTime.endTime
				})
			});

			const data = await response.json();

			if (!response.ok) {
				error = data.error;
				return;
			}

			// Redirect to success page
			goto('/booking/reschedule/success');
		} catch (e) {
			error = 'Failed to reschedule booking';
		} finally {
			isRescheduling = false;
		}
	}

	function handleDateSelect(date: Date) {
		selectedDate = date;
		selectedStartTime = null;
	}

	function handleStartTimeSelect(time: { startTime: string; endTime: string }) {
		selectedStartTime = time;
	}
</script>

<div class="container mx-auto max-w-4xl px-4 py-8">
	<h1 class="mb-8 text-center text-3xl font-bold">Omboka din tid</h1>

	{#if error}
		<div class="mb-8 rounded-lg bg-red-100 p-4 text-red-700">
			<p>{error}</p>
		</div>
	{:else if !booking}
		<div class="flex h-64 items-center justify-center">
			<div
				class="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
			></div>
		</div>
	{:else}
		<div class="mb-8 rounded-lg bg-gray-100 p-6">
			<h2 class="mb-4 text-xl font-semibold">Nuvarande bokning</h2>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<p class="text-sm text-gray-600">Aktivitet</p>
					<p class="font-medium">{booking.experience.name}</p>
				</div>
				<div>
					<p class="text-sm text-gray-600">Datum</p>
					<p class="font-medium">{booking.startDate}</p>
				</div>
				<div>
					<p class="text-sm text-gray-600">Tid</p>
					<p class="font-medium">{booking.startTime} - {booking.endTime}</p>
				</div>
			</div>
		</div>

		<div class="space-y-8">
			<section>
				<h2 class="mb-4 text-center text-2xl font-semibold">Välj nytt datum</h2>
				<div class="flex justify-center">
					<Calendar
						durationType={booking.duration.type}
						durationValue={booking.duration.value}
						blockedDates={data.blockedDates}
						openDates={data.openDates}
						onDateSelect={handleDateSelect}
						bookingForesightHours={parseFloat(booking.experience.booking_foresight_hours)}
					/>
				</div>
			</section>

			{#if selectedDate}
				<section>
					<h2 class="mb-4 text-center text-2xl font-semibold">Välj ny tid</h2>
					<AvailableStartTimes
						experienceId={booking.experienceId}
						{selectedDate}
						durationType={booking.duration.type}
						durationValue={booking.duration.value}
						selectedProducts={booking.products}
						selectedAddons={booking.addons}
						onStartTimeSelect={handleStartTimeSelect}
						showButton={true}
					/>
				</section>
			{/if}

			{#if selectedStartTime}
				<div class="flex justify-center">
					<button
						class="rounded-lg bg-primary px-8 py-3 text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
						onclick={handleReschedule}
						disabled={isRescheduling}
					>
						{isRescheduling ? 'Ombokar...' : 'Bekräfta ombokning'}
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>
