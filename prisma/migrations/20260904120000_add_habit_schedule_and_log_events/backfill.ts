// Backfill de HabitSchedule pros hábitos criados antes desta migration.
// Não roda automaticamente (Prisma não executa .ts em migrations) —
// disparo manual: npx tsx prisma/migrations/20260904120000_add_habit_schedule_and_log_events/backfill.ts
import { PrismaClient } from "../../../src/generated/prisma/client";

const prisma = new PrismaClient();

function dateOnlyUTC(instant: Date): Date {
    return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
}

async function main() {
    const habits = await prisma.habit.findMany({
        where: { schedules: { none: {} } },
        select: { id: true, createdAt: true },
    });

    console.log(`Hábitos sem HabitSchedule: ${habits.length}`);

    for (const habit of habits) {
        await prisma.habitSchedule.create({
            data: {
                habitId: habit.id,
                type: "DAILY",
                targetPerDay: 1,
                daysOfWeek: [],
                effectiveFrom: dateOnlyUTC(habit.createdAt),
                effectiveFromAt: habit.createdAt,
            },
        });
    }

    console.log("Backfill concluído.");
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
