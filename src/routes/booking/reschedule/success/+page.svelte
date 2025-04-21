<script lang="ts">
	import { goto } from '$app/navigation';
</script>

<div class="container mx-auto max-w-4xl px-4 py-16">
	<div class="text-center">
		<div class="mb-8 flex justify-center">
			<svg
				class="h-16 w-16 text-green-500"
				xmlns="http://www.w3.org/2000/svg"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
			</svg>
		</div>

		<h1 class="mb-4 text-3xl font-bold">Din ombokning är klar!</h1>
		<p class="mb-8 text-gray-600">
			Vi har skickat en ny bokningsbekräftelse till din e-post med de uppdaterade uppgifterna.
		</p>

		<button
			class="rounded-lg bg-primary px-8 py-3 text-white hover:bg-primary/90"
			onclick={() => goto('/')}
		>
			Tillbaka till startsidan
		</button>
	</div>
</div>
