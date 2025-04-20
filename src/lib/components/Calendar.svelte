<script lang="ts">
	import { format, addDays, isWithinInterval, parseISO, isAfter } from 'date-fns';
	import { sv } from 'date-fns/locale';
	import { cn } from '$lib/utils';

	interface BlockedDate {
		id: number;
		experience_id: number;
		start_date: string;
		end_date: string;
		reason: string | null;
		created_at: string;
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

	let {
		durationType,
		durationValue,
		blockedDates = [],
		openDates = [],
		onDateSelect = (date: Date) => {},
		isLocked = $bindable(false),
		bookingForesightHours
	} = $props<{
		durationType: string;
		durationValue: number;
		blockedDates: BlockedDate[];
		openDates: OpenDate[];
		onDateSelect?: (date: Date) => void;
		isLocked?: boolean;
		bookingForesightHours: number;
	}>();

	let selectedDate = $state<Date | null>(null);
	let hoveredDate = $state<Date | null>(null);
	let hasFutureOpenDates = $state(false);

	// Add effect to reset selected date when duration changes
	$effect(() => {
		// This will run whenever durationType or durationValue changes
		if (selectedDate && isDateDisabled(selectedDate)) {
			selectedDate = null;
			onDateSelect(null); // Notify parent that date was reset
		}
	});

	// Initialize the calendar
	function initializeCalendar() {
		// Always start with current month
		currentMonth = new Date();

		// Check if there are any future open dates
		hasFutureOpenDates = openDates.some((date: OpenDate) => {
			if (date.type === 'specific' && date.specific_date) {
				return isAfter(parseISO(date.specific_date), currentMonth);
			}
			if (date.type === 'interval' && date.end_date) {
				return isAfter(parseISO(date.end_date), currentMonth);
			}
			return false;
		});
	}

	let currentMonth = $state(new Date());

	// Initialize when component mounts
	initializeCalendar();

	// Calculate the number of days to highlight based on duration
	function getDurationDays() {
		if (!durationValue) return 1;
		if (durationType === 'hours') return 1;
		if (durationType === 'overnights') return durationValue + 1;
		return 1;
	}

	// Check if a date is open for booking
	function isDateOpen(date: Date): boolean {
		// Convert local date to UTC date string (YYYY-MM-DD)
		const localDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
		const utcDate = new Date(localDate.getTime() - localDate.getTimezoneOffset() * 60000);
		const dateStr = utcDate.toISOString().split('T')[0];

		return openDates.some((openDate: OpenDate) => {
			if (openDate.type === 'specific') {
				const specificDate = openDate.specific_date?.split('T')[0];
				return specificDate === dateStr;
			}
			const startDate = openDate.start_date?.split('T')[0];
			const endDate = openDate.end_date?.split('T')[0];

			return startDate && endDate && dateStr >= startDate && dateStr <= endDate;
		});
	}

	// Check if a date should be disabled
	function isDateDisabled(date: Date): boolean {
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		// Don't allow dates in the past
		if (date < today) return true;

		// Check if date is not in any open dates
		if (!isDateOpen(date)) return true;

		// Check if the full duration period would extend beyond any open date range
		const durationDays = getDurationDays();
		const endDateForDuration = addDays(date, durationDays - 1);

		// Convert local date to UTC strings for comparison
		const endDateStr = new Date(
			endDateForDuration.getTime() - endDateForDuration.getTimezoneOffset() * 60000
		)
			.toISOString()
			.split('T')[0];

		// Check if the full duration period is within any open date range
		const isWithinOpenPeriod = openDates.some((openDate: OpenDate) => {
			if (openDate.type === 'specific') {
				return openDate.specific_date?.split('T')[0] === endDateStr;
			}
			const endDate = openDate.end_date?.split('T')[0];
			return endDate && endDateStr <= endDate;
		});

		if (!isWithinOpenPeriod) return true;

		// Check if date is in blocked dates
		const localDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
		const utcDate = new Date(localDate.getTime() - localDate.getTimezoneOffset() * 60000);
		const dateStr = utcDate.toISOString().split('T')[0];

		const isBlockedDate = blockedDates.some((blocked: BlockedDate) => {
			const startDate = blocked.start_date.split('T')[0];
			const endDate = blocked.end_date.split('T')[0];
			// Check if any day in the duration period overlaps with blocked dates
			return dateStr >= startDate && endDateStr <= endDate;
		});

		if (isBlockedDate) return true;

		// Handle booking foresight
		if (bookingForesightHours > 0) {
			const now = new Date();
			const closeTimeToday = openDates.find((openDate: OpenDate) => {
				if (openDate.type === 'specific' && openDate.specific_date) {
					return openDate.specific_date.split('T')[0] === format(now, 'yyyy-MM-dd');
				}
				if (openDate.type === 'interval') {
					const startDate = parseISO(openDate.start_date!);
					const endDate = parseISO(openDate.end_date!);
					return now >= startDate && now <= endDate;
				}
				return false;
			});

			if (closeTimeToday) {
				const [closeHours, closeMinutes] = closeTimeToday.close_time.split(':').map(Number);
				const closingTime = new Date(now);
				closingTime.setHours(closeHours, closeMinutes, 0, 0);

				// If we're past closing time, we need to consider the next day's foresight
				const isPastClosingTime = now > closingTime;
				const foresightDate = new Date(now.getTime() + bookingForesightHours * 60 * 60 * 1000);

				// Block the date if it's within the foresight period
				if (date <= foresightDate) {
					if (isPastClosingTime && date.getDate() === now.getDate()) {
						// Block today if we're past closing time
						return true;
					}
					if (date.getDate() === now.getDate() + 1 && isPastClosingTime) {
						// Block tomorrow if we're past closing time
						return true;
					}
					if (date.getDate() === now.getDate() && !isPastClosingTime) {
						// Block today if we're before closing time but within foresight
						return true;
					}
				}
			}
		}

		return false;
	}

	// Check if a date is part of the selected range
	function isInSelectedRange(date: Date) {
		if (!selectedDate) return false;
		const durationDays = getDurationDays();
		const endDate = addDays(selectedDate, durationDays - 1);
		return isWithinInterval(date, { start: selectedDate, end: endDate });
	}

	// Check if a date is part of the hovered range
	function isInHoveredRange(date: Date) {
		if (!hoveredDate) return false;
		const durationDays = getDurationDays();
		const endDate = addDays(hoveredDate, durationDays - 1);
		return isWithinInterval(date, { start: hoveredDate, end: endDate });
	}

	function handleDateSelect(date: Date) {
		if (isDateDisabled(date) || isLocked) return;
		selectedDate = date;

		// Create UTC date at noon to avoid timezone issues
		const utcDate = new Date(
			Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0)
		);

		onDateSelect(utcDate);
	}

	function getCalendarDays() {
		const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
		const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
		const days = [];

		// Get the day of the week for the first day (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
		let firstDayOfWeek = start.getDay();
		// Convert Sunday from 0 to 7 to match our Monday-first calendar
		firstDayOfWeek = firstDayOfWeek === 0 ? 7 : firstDayOfWeek;
		// Adjust to make Monday = 1
		firstDayOfWeek -= 1;

		// Add padding days for the start of the month
		for (let i = firstDayOfWeek - 1; i >= 0; i--) {
			const paddingDate = new Date(start);
			paddingDate.setDate(paddingDate.getDate() - (i + 1));
			days.push({
				date: paddingDate,
				isCurrentMonth: false
			});
		}

		// Add current month's days
		for (let i = 1; i <= end.getDate(); i++) {
			days.push({
				date: new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i),
				isCurrentMonth: true
			});
		}

		// Add padding days for the end of the month if needed
		const lastDayOfWeek = end.getDay();
		const remainingDays = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek;

		for (let i = 1; i <= remainingDays; i++) {
			const paddingDate = new Date(end);
			paddingDate.setDate(paddingDate.getDate() + i);
			days.push({
				date: paddingDate,
				isCurrentMonth: false
			});
		}

		return days;
	}

	const weekDays = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];
</script>

<div class="calendar">
	<div class="calendar-header">
		<button
			class={cn('month-nav', isLocked && 'cursor-not-allowed opacity-50')}
			onclick={() => {
				if (!isLocked) {
					currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1);
				}
			}}
			disabled={isLocked}
		>
			&lt;
		</button>
		<h2>{format(currentMonth, 'MMMM yyyy', { locale: sv })}</h2>
		<button
			class={cn('month-nav', isLocked && 'cursor-not-allowed opacity-50')}
			onclick={() => {
				if (!isLocked) {
					currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1);
				}
			}}
			disabled={isLocked}
		>
			&gt;
		</button>
	</div>

	{#if hasFutureOpenDates && !getCalendarDays().some(({ date }) => isDateOpen(date) && !isDateDisabled(date))}
		<div class="future-dates-notice">
			<svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 20 20" fill="currentColor">
				<path
					fill-rule="evenodd"
					d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13a1 1 0 102 0V9.414l1.293 1.293a1 1 0 001.414-1.414z"
					clip-rule="evenodd"
				/>
			</svg>
			<span>Det finns lediga datum längre fram - bläddra framåt för att se dem</span>
		</div>
	{/if}

	<div class="calendar-grid">
		<div class="weekdays-grid">
			{#each weekDays as day}
				<div class="weekday">{day}</div>
			{/each}
		</div>

		<div class="days-grid">
			{#each getCalendarDays() as { date, isCurrentMonth }}
				<button
					class={cn(
						'relative flex aspect-square w-full flex-col items-center justify-center rounded-full text-sm md:text-base',
						!isCurrentMonth && 'opacity-25',
						selectedDate && isInSelectedRange(date) && 'bg-primary text-white',
						!isInSelectedRange(date) && isInHoveredRange(date) && 'bg-gray-100',
						(isDateDisabled(date) || isLocked) && 'cursor-not-allowed text-gray-300',
						isDateOpen(date) &&
							!isDateDisabled(date) &&
							!isInSelectedRange(date) &&
							'hover:bg-gray-100'
					)}
					onclick={() => handleDateSelect(date)}
					onmouseenter={() => (hoveredDate = date)}
					onmouseleave={() => (hoveredDate = null)}
					disabled={!isCurrentMonth || isDateDisabled(date) || isLocked}
				>
					<span class="date-number">{date.getDate()}</span>
					{#if isDateOpen(date) && !isDateDisabled(date)}
						<span
							class={cn(
								'absolute bottom-1 h-1.5 w-1.5 rounded-full md:h-2 md:w-2',
								selectedDate && isInSelectedRange(date) ? 'bg-white' : 'bg-green-500'
							)}
						></span>
					{/if}
				</button>
			{/each}
		</div>
	</div>
</div>

<style lang="postcss">
	.calendar {
		@apply mx-auto w-[320px] rounded-lg bg-white p-4 shadow md:w-[400px] lg:w-[480px];
		min-height: 400px;
		display: flex;
		flex-direction: column;
	}

	.calendar-header {
		@apply flex items-center justify-between;
		height: 40px;
	}

	.calendar-header h2 {
		@apply text-lg font-semibold capitalize md:text-xl;
	}

	.month-nav {
		@apply rounded-full p-2 hover:bg-gray-100;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.calendar-grid {
		@apply flex flex-1 flex-col;
		margin-top: 1rem;
	}

	.weekdays-grid {
		@apply grid grid-cols-7 gap-1;
		height: 32px;
	}

	.weekday {
		@apply flex items-center justify-center text-center text-sm font-medium text-gray-500 md:text-base;
	}

	.days-grid {
		@apply grid grid-cols-7 gap-1 md:gap-2;
		flex: 1;
		margin-top: 0.5rem;
	}

	.future-dates-notice {
		height: 56px;
		@apply flex items-center gap-2 rounded-md bg-blue-50 p-3 text-sm text-blue-700 md:text-base;
		margin: 1rem 0;
	}

	.future-dates-notice .icon {
		@apply h-5 w-5 flex-shrink-0 md:h-6 md:w-6;
	}
</style>
