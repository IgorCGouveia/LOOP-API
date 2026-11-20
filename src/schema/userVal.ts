import {z} from 'zod';

const IANA_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

// regras por campo, compartilhadas entre cadastro e update. O que é
// compartilhado é a validação de cada campo, não a lista de campos —
// cada schema declara a própria lista (ver doc-2/adr/0002).
const nameField = z.string()
    .min(3, 'Nome é obrigatório')
    .max(50, 'Maximo 50 caracteres');

const emailField = z.email({message: 'Formato de email inválido.'});

const passwordField = z
    .string()
    .min(8)
    .max(128);

const confirmPasswordField = z
    .string()
    .min(8);

const timezoneField = z.string()
    .refine((tz) => IANA_TIMEZONES.has(tz), {
        message: "Timezone inválido. Use um identificador IANA (ex: 'America/Sao_Paulo').",
    });

export const CreateUserVal = z.object({
    name: nameField,
    email: emailField,
    password: passwordField,
    confirmPassword: confirmPasswordField,
    timezone: timezoneField,
})
.refine(
    (data) =>   data.confirmPassword == data.password,
    "As senhas não coincidem"
);

// allowlist explícita: só estes campos podem mudar depois do cadastro.
// strictObject rejeita qualquer outra chave com 400 em vez de ignorar —
// timezone fica de fora de propósito, porque os dias já gravados
// dependem dele (doc-2/adr/0002).
export const UpdateUserVal = z.strictObject({
    name: nameField.optional(),
    email: emailField.optional(),
    password: passwordField.optional(),
    confirmPassword: confirmPasswordField.optional(),
}, {
    error: (issue) => issue.code === "unrecognized_keys"
        ? `Campo não pode ser alterado: ${issue.keys.join(", ")}.`
        : undefined,
})
.refine(
    (data) =>   data.confirmPassword == data.password,
    "As senhas não coincidem"
);

export type CreateUserInput = z.infer<typeof CreateUserVal>;
export type UpdateUserInput = z.infer<typeof UpdateUserVal>;
