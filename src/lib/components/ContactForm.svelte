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
	import { formatPrice, getDisplayPrice, getPaymentPrice } from '$lib/utils/price';

	interface SelectedProduct {
		productId: number;
		quantity: number;
		price?: number;
	}

	interface SelectedAddon {
		addonId: number;
		quantity: number;
		price?: number;
	}

	interface SelectedStartTime {
		startTime: string;
		endTime: string;
	}

	type Booking = {
		selectedLocationId: number | null;
		selectedDuration: string;
		durationType: 'hours' | 'overnights';
		durationValue: number;
		selectedDate: Date | null;
		selectedProducts: SelectedProduct[];
		selectedAddons: SelectedAddon[];
		priceGroupQuantities: Record<number, number>;
		selectedStartTime: SelectedStartTime | null;
		totalPrice: number;
	};

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

	let { data, totalPrice, bookings, experienceId, experienceType } = $props<{
		data?: {
			form: SuperValidated<FormSchema>;
		};
		totalPrice: number;
		bookings: Array<Booking>;
		experienceId: number;
		experienceType: string;
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
				const bookingData = bookings.map((booking: Booking) => ({
					firstName: formValues.firstName,
					lastName: formValues.lastName,
					email: formValues.email,
					phone: formValues.phone,
					comment: formValues.comment,
					experienceId,
					experienceType,
					startLocationId: booking.selectedLocationId,
					durationId: booking.selectedDuration,
					startDate: booking.selectedDate?.toISOString().split('T')[0],
					products: booking.selectedProducts,
					addons: booking.selectedAddons,
					priceGroups: Object.entries(booking.priceGroupQuantities).map(([id, quantity]) => ({
						id: parseInt(id),
						quantity
					})),
					startTime: booking.selectedStartTime?.startTime,
					endTime: booking.selectedStartTime?.endTime,
					hasBookingGuarantee: booking.selectedAddons?.some((addon) => addon.addonId === 4),
					totalPrice: booking.totalPrice
				}));

				const response = await fetch('/api/create-checkout-session', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						bookings: bookingData
					})
				});

				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}

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

	let totalBookingsPrice = $derived(() => {
		return bookings.reduce((sum: number, b: { totalPrice: number }) => sum + b.totalPrice, 0);
	});

	let displayTotalPrice = $derived(() => {
		const baseTotal = totalBookingsPrice();
		const totalIncVat = getPaymentPrice(baseTotal, experienceType);

		if (experienceType === 'private') {
			return formatPrice(totalIncVat);
		}
		return `${formatPrice(baseTotal)} exkl. moms (${formatPrice(totalIncVat)} inkl. moms)`;
	});
</script>

<div class="mx-auto max-w-2xl space-y-8">
	<div class="space-y-4">
		<h2 class="text-center text-2xl font-semibold">Din bokning</h2>
		{#each bookings as booking, i}
			<div class="space-y-2 rounded-lg border p-4">
				<h3 class="font-medium">Bokning {i + 1}</h3>
				{#if booking.selectedDate}
					<p>Datum: {new Date(booking.selectedDate).toLocaleDateString('sv-SE')}</p>
				{/if}
				{#if booking.selectedStartTime}
					<p>Tid: {booking.selectedStartTime.startTime} - {booking.selectedStartTime.endTime}</p>
				{/if}
				{#if booking.selectedProducts.length > 0}
					<p>Utrustning:</p>
					<ul class="list-disc pl-4">
						{#each booking.selectedProducts as product}
							<li>{product.quantity}x Produkt {product.productId}</li>
						{/each}
					</ul>
				{/if}
				{#if booking.selectedAddons.length > 0}
					<p>Tillägg:</p>
					<ul class="list-disc pl-4">
						{#each booking.selectedAddons as addon}
							<li>{addon.quantity}x Tillägg {addon.addonId}</li>
						{/each}
					</ul>
				{/if}
				<div class="border-t pt-2">
					<p class="font-medium">
						Pris för denna bokning:
						{#if experienceType === 'private'}
							{formatPrice(getPaymentPrice(booking.totalPrice, experienceType))}
						{:else}
							{formatPrice(booking.totalPrice)} exkl. moms ({formatPrice(
								getPaymentPrice(booking.totalPrice, experienceType)
							)} inkl. moms)
						{/if}
					</p>
				</div>
			</div>
		{/each}
		<div class="rounded-lg border bg-muted p-4">
			<p class="text-xl font-semibold">
				Pris total för alla bokningar: {displayTotalPrice()}
			</p>
		</div>
	</div>

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
