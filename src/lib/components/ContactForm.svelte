<script lang="ts">
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Textarea } from '$lib/components/ui/textarea';
	import { PhoneInput } from '$lib/components/extra/ui/phone-input';
	import { superForm, type SuperValidated } from 'sveltekit-superforms/client';
	import { zodClient } from 'sveltekit-superforms/adapters';
	import { z } from 'zod';
	import { stripePromise } from '$lib/stripe';
	import { Elements, PaymentElement } from '@stripe/stripe-js';
	import { generateBookingNumber } from '$lib/utils/booking';

	// Define the form schema
	const formSchema = z.object({
		firstName: z.string().min(2, 'Förnamn måste vara minst 2 tecken'),
		lastName: z.string().min(2, 'Efternamn måste vara minst 2 tecken'),
		email: z.string().email('Ogiltig e-postadress'),
		phone: z.string().min(1, 'Telefonnummer krävs'),
		comment: z.string().optional(),
		acceptTerms: z.boolean().refine((val) => val === true, {
			message: 'Du måste godkänna bokningsavtalet och köpvillkoren'
		})
	}) satisfies z.ZodType<Record<string, unknown>>;

	type FormSchema = z.infer<typeof formSchema>;

	let { data, totalPrice } = $props<{
		data?: {
			form: SuperValidated<FormSchema>;
		};
		totalPrice: number;
	}>();

	let clientSecret = $state<string | null>(null);
	let processing = $state(false);
	let error = $state<string | null>(null);

	const defaultData = {
		firstName: '',
		lastName: '',
		email: '',
		phone: '',
		comment: '',
		acceptTerms: false
	};

	const form = superForm(data?.form ?? defaultData, {
		validators: zodClient(formSchema)
	});

	const { form: formData, enhance } = form;

	async function handleSubmit(event: Event) {
		event.preventDefault();
		if (processing) return;

		try {
			processing = true;
			error = null;

			// Generate a unique booking number
			const bookingNumber = generateBookingNumber();

			// Create payment intent
			const response = await fetch('/api/create-payment-intent', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					amount: totalPrice * 100, // Convert to öre
					bookingData: {
						bookingNumber
					}
				})
			});

			if (!response.ok) throw new Error('Failed to create payment intent');
			const { clientSecret: secret } = await response.json();
			clientSecret = secret;
		} catch (e) {
			error = e instanceof Error ? e.message : 'An error occurred';
		} finally {
			processing = false;
		}
	}

	async function handlePayment(event: CustomEvent) {
		// Handle successful payment
		if (event.detail.paymentIntent.status === 'succeeded') {
			// Store booking data
			await storeBookingData(event.detail.paymentIntent);
			// Redirect to success page
			window.location.href = `/booking/success/${bookingNumber}`;
		}
	}
</script>

<div class="mx-auto max-w-2xl space-y-8">
	<div class="space-y-2 text-center">
		<h2 class="text-2xl font-semibold">Kontaktuppgifter</h2>
		<p class="text-muted-foreground">Fyll i dina kontaktuppgifter för bokningen</p>
	</div>

	<form method="POST" use:enhance class="space-y-6">
		<div class="grid gap-4 sm:grid-cols-2">
			<Form.Field {form} name="firstName">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>Förnamn *</Form.Label>
						<Input {...props} bind:value={$formData.firstName} />
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="lastName">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>Efternamn *</Form.Label>
						<Input {...props} bind:value={$formData.lastName} />
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		</div>

		<Form.Field {form} name="email">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>E-post *</Form.Label>
					<Input {...props} type="email" bind:value={$formData.email} />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="phone">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>Telefonnummer *</Form.Label>
					<PhoneInput {...props} bind:value={$formData.phone} defaultCountry="SE" />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="comment">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>Kommentar</Form.Label>
					<Textarea {...props} bind:value={$formData.comment} />
				{/snippet}
			</Form.Control>
			<Form.Description>Frivillig kommentar till din bokning</Form.Description>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="acceptTerms">
			<Form.Control>
				{#snippet children({ props })}
					<div class="flex items-start space-x-2">
						<Checkbox {...props} bind:checked={$formData.acceptTerms} />
						<div class="grid gap-1.5 leading-none">
							<Form.Label class="text-sm font-medium leading-none">
								Jag godkänner bokningsavtalet och köpvillkoren *
							</Form.Label>
							<p class="text-sm text-muted-foreground">
								<a href="/terms" class="underline hover:text-primary">Klicka här</a>
								för att läsa bokningsavtalet och köpvillkoren
							</p>
						</div>
					</div>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		{#if clientSecret}
			<Elements stripe={stripePromise} options={{ clientSecret }}>
				<PaymentElement />
				<button class="w-full" disabled={processing} onclick={handlePayment}>
					{processing ? 'Processing...' : 'Pay now'}
				</button>
			</Elements>
		{:else}
			<button class="w-full" onclick={handleSubmit} disabled={processing}>
				Continue to payment
			</button>
		{/if}

		{#if error}
			<p class="text-destructive">{error}</p>
		{/if}
	</form>
</div>
