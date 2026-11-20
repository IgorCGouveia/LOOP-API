// Cria a 1ª versão de HabitSchedule pros hábitos que não têm nenhuma.
// Uso: npm run backfill:schedules
// Roteiro: doc-2/guides/backfill-habit-schedule.md
import { prisma } from "../db";
import { backfillHabitSchedules } from "./habitScheduleBackfill";

backfillHabitSchedules()
    .then((count) => console.log(`Hábitos sem HabitSchedule preenchidos: ${count}`))
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
