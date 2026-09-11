import {z} from 'zod';

const IANA_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

export const CreateUserVal = z.object({
    name: z.string()
        .min(3, 'Nome é obrigatório')
        .max(50, 'Maximo 50 caracteres'),
    email: z.email({message: 'Formato de email inválido.'}),
    password: z
        .string()
        .min(8)
        .max(128),

    confirmPassword:z
        .string()
        .min(8),

    timezone: z.string()
        .refine((tz) => IANA_TIMEZONES.has(tz), {
            message: "Timezone inválido. Use um identificador IANA (ex: 'America/Sao_Paulo').",
        }),
})
.refine(
    (data) =>   data.confirmPassword == data.password,
    "As senhas não coincidem"
);

export const UpdateUserVal = z.object(CreateUserVal.shape)
.partial()
.refine(
    (data) =>   data.confirmPassword == data.password,
    "As senhas não coincidem"
);

export type CreateUserInput = z.infer<typeof CreateUserVal>;
export type UpdateUserInput = z.infer<typeof UpdateUserVal>;