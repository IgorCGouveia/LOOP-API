import {z} from 'zod';

// frequência/meta do hábito. União discriminada por type — cada
// variante só aceita os campos que fazem sentido pra ela.
export const ScheduleVal = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("DAILY"),
        targetPerDay: z.number().int().positive(),
    }),
    z.object({
        type: z.literal("WEEKLY"),
        targetPerDay: z.number().int().positive(),
        daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
    }),
    z.object({
        type: z.literal("INTERVAL"),
        targetPerDay: z.number().int().positive(),
        intervalDays: z.number().int().positive(),
    }),
]);

export const CreateHabitVal = z.object({
    name: z.string()
        .trim()
        .min(3, "Mínimo de 3 letras para criar um hábito.")
        .max(50, "Máximo de 50 letras para nome do hábito."),
    description:  z.string()
        .max(250, "Máximo 250 caracteres.")
        .optional(),

    userId: z.cuid2("ID de usuário inválido."),

    // omitido = daily 1x (default aplicado no service). Quando vier no
    // PATCH, precisa vir inteiro — .partial() só torna a chave opcional,
    // não entra dentro da união.
    schedule: ScheduleVal.optional(),
})

export const UpdateHabitVal = CreateHabitVal.partial();

export type CreateHabitInput = z.infer<typeof CreateHabitVal>;
export type UpdateHabitInput = z.infer<typeof UpdateHabitVal>;
export type ScheduleInput = z.infer<typeof ScheduleVal>;