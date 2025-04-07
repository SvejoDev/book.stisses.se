import { z } from 'zod';

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

export type FormSchema = z.infer<typeof formSchema>; 