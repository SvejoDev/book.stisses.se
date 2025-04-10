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

	// Define the form schema
	export const formSchema = z.object({
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

	let { data, totalPrice, bookingData } = $props<{
		data?: {
			form: SuperValidated<FormSchema>;
		};
		totalPrice: number;
		bookingData: any;
	}>();

	const defaultData = {
		firstName: '',
		lastName: '',
		email: '',
		phone: '',
		comment: '',
		acceptTerms: false
	};

	const form = superForm(data?.form ?? defaultData, {
		validators: zodClient(formSchema),
		validationMethod: 'oninput',
		onSubmit: async ({ formData }) => {
			try {
				const formValues = Object.fromEntries(formData);
				const hasBookingGuarantee =
					bookingData.addons?.some((addon: any) => addon.addonId === 4 && addon.quantity > 0) ??
					false;

				// Ensure priceGroups is an array
				const priceGroupsData = Array.isArray(bookingData.priceGroups)
					? bookingData.priceGroups
					: Object.entries(bookingData.priceGroups || {}).map(([id, quantity]) => ({
							id: parseInt(id),
							quantity
						}));

				const response = await fetch('/api/create-checkout-session', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						firstName: formValues.firstName,
						lastName: formValues.lastName,
						email: formValues.email,
						phone: formValues.phone,
						comment: formValues.comment,
						...bookingData,
						priceGroups: priceGroupsData,
						hasBookingGuarantee,
						totalPrice
					})
				});

				const { url, error } = await response.json();
				if (error) throw new Error(error);
				window.location.href = url;
			} catch (error) {
				console.error('Error creating checkout session:', error);
			}
		}
	});

	const { form: formData, enhance, errors } = form;

	let isFormValid = $derived(
		!$errors.firstName &&
			!$errors.lastName &&
			!$errors.email &&
			!$errors.phone &&
			$formData.acceptTerms
	);
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
						<Input {...props} bind:value={$formData.firstName} required />
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="lastName">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>Efternamn *</Form.Label>
						<Input {...props} bind:value={$formData.lastName} required />
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		</div>

		<Form.Field {form} name="email">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>E-post *</Form.Label>
					<Input {...props} type="email" bind:value={$formData.email} required />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="phone">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>Telefonnummer *</Form.Label>
					<PhoneInput {...props} bind:value={$formData.phone} defaultCountry="SE" required />
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
						<Checkbox {...props} bind:checked={$formData.acceptTerms} required />
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

		<Button type="submit" class="w-full" disabled={!isFormValid}>
			{#if !isFormValid}
				Fyll i alla obligatoriska fält
			{:else}
				Fortsätt till betalning
			{/if}
		</Button>
	</form>
</div>
