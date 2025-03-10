<script lang="ts">
	import { format, addDays, isWithinInterval, parseISO } from 'date-fns';
	import { sv } from 'date-fns/locale';

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
		selectedDuration,
		durationType,
		durationValue,
		blockedDates = [],
		openDates = []
	} = $props<{
		selectedDuration: string;
		durationType: string;
		durationValue: number;
		blockedDates: BlockedDate[];
		openDates: OpenDate[];
	}>();

	let selectedDate = $state<Date | null>(null);
	let hoveredDate = $state<Date | null>(null);
	let currentMonth = $state(new Date());

	// Calculate the number of days to highlight based on duration
	function getDurationDays() {
		if (!durationValue) return 1;
		if (durationType === 'hours') return 1;
		if (durationType === 'overnights') return durationValue + 1;
		return 1;
	}

	// Check if a date is open for booking
	function isDateOpen(date: Date): boolean {
		const dateStr = date.toISOString().split('T')[0];

		return openDates.some((openDate: OpenDate) => {
			if (openDate.type === 'specific') {
				return openDate.specific_date === dateStr;
			}
			return (
				openDate.start_date &&
				openDate.end_date &&
				dateStr >= openDate.start_date &&
				dateStr <= openDate.end_date
			);
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

		// Check if date is in blocked dates
		const dateStr = date.toISOString().split('T')[0];
		return blockedDates.some(
			(blocked: BlockedDate) => dateStr >= blocked.start_date && dateStr <= blocked.end_date
		);
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
		if (!hoveredDate || selectedDate) return false;
		const durationDays = getDurationDays();
		const endDate = addDays(hoveredDate, durationDays - 1);
		return isWithinInterval(date, { start: hoveredDate, end: endDate });
	}

	function handleDateSelect(date: Date) {
		if (isDateDisabled(date)) return;
		selectedDate = date;
	}

	function getCalendarDays() {
		const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
		const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
		const days = [];

		// Add previous month's days
		const startDay = start.getDay();
		for (let i = 0; i < startDay; i++) {
			days.push({
				date: addDays(start, -startDay + i),
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

		// Add next month's days
		const remainingDays = 42 - days.length;
		for (let i = 1; i <= remainingDays; i++) {
			days.push({
				date: addDays(end, i),
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
			class="month-nav"
			onclick={() =>
				(currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
		>
			&lt;
		</button>
		<h2>{format(currentMonth, 'MMMM yyyy', { locale: sv })}</h2>
		<button
			class="month-nav"
			onclick={() =>
				(currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
		>
			&gt;
		</button>
	</div>

	<div class="calendar-grid">
		{#each weekDays as day}
			<div class="weekday">{day}</div>
		{/each}

		{#each getCalendarDays() as { date, isCurrentMonth }}
			<button
				class="day"
				class:other-month={!isCurrentMonth}
				class:selected={selectedDate && isInSelectedRange(date)}
				class:hovered={!selectedDate && isInHoveredRange(date)}
				class:disabled={isDateDisabled(date)}
				class:open={isDateOpen(date) && !isDateDisabled(date)}
				onclick={() => handleDateSelect(date)}
				onmouseenter={() => (hoveredDate = date)}
				onmouseleave={() => (hoveredDate = null)}
				disabled={isDateDisabled(date)}
			>
				<span class="date-number">{date.getDate()}</span>
				{#if isDateOpen(date) && !isDateDisabled(date)}
					<span class="open-indicator" />
				{/if}
			</button>
		{/each}
	</div>
</div>

<style lang="postcss">
	.calendar {
		@apply mx-auto max-w-sm rounded-lg bg-white p-4 shadow;
	}

	.calendar-header {
		@apply mb-4 flex items-center justify-between;
	}

	.calendar-header h2 {
		@apply text-lg font-semibold capitalize;
	}

	.month-nav {
		@apply rounded-full p-2 hover:bg-gray-100;
	}

	.calendar-grid {
		@apply grid grid-cols-7 gap-1;
	}

	.weekday {
		@apply py-2 text-center text-sm font-medium text-gray-500;
	}

	.day {
		@apply relative flex h-10 w-10 flex-col items-center justify-center rounded-full text-sm;
	}

	.day:not(.selected):hover:not(.disabled) {
		@apply bg-gray-100;
	}

	.other-month {
		@apply text-gray-400;
	}

	.selected {
		@apply bg-primary text-white;
	}

	.disabled {
		@apply cursor-not-allowed text-gray-300;
	}

	.disabled:hover {
		@apply bg-transparent;
	}

	.open-indicator {
		@apply absolute bottom-1 h-1.5 w-1.5 rounded-full bg-green-500;
	}

	.selected .open-indicator {
		@apply bg-white;
	}
</style>
