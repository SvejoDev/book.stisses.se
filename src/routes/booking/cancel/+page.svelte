<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';

	let isCleaningUp = $state(true);
	let cleanupError = $state<string | null>(null);

	onMount(async () => {
		// Get session_id from URL if available
		const sessionId = $page.url.searchParams.get('session_id');

		if (sessionId) {
			try {
				// Clean up the failed payment reservation
				const response = await fetch('/api/cleanup-expired', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ sessionId })
				});

				if (!response.ok) {
					throw new Error('Failed to cleanup reservation');
				}

				console.log('Successfully cleaned up failed payment reservation');
			} catch (error) {
				console.error('Error cleaning up reservation:', error);
				cleanupError = 'Kunde inte rensa reservationen';
			}
		}

		isCleaningUp = false;

		// Redirect to home page after 3 seconds
		setTimeout(() => {
			goto('/');
		}, 3000);
	});
</script>

<svelte:head>
	<title>Betalning avbruten</title>
</svelte:head>

<div class="container mx-auto max-w-2xl px-4 py-16 text-center">
	<div class="space-y-6">
		<div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-orange-100">
			<svg class="h-8 w-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
				></path>
			</svg>
		</div>

		<h1 class="text-3xl font-bold text-gray-900">Betalning avbruten</h1>

		{#if isCleaningUp}
			<p class="text-gray-600">Rensar din reservation...</p>
			<div class="flex justify-center">
				<div class="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
			</div>
		{:else if cleanupError}
			<div class="space-y-4">
				<p class="text-red-600">{cleanupError}</p>
				<p class="text-gray-600">
					Din reservation kan fortfarande vara aktiv. Kontakta oss om du behöver hjälp.
				</p>
			</div>
		{:else}
			<div class="space-y-4">
				<p class="text-gray-600">Din betalning avbröts och reservationen har rensats.</p>
				<p class="text-sm text-gray-500">Du omdirigeras till startsidan om 3 sekunder...</p>
			</div>
		{/if}

		<div class="pt-4">
			<a
				href="/"
				class="inline-flex items-center rounded-md border border-transparent bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
			>
				Tillbaka till startsidan
			</a>
		</div>
	</div>
</div>
