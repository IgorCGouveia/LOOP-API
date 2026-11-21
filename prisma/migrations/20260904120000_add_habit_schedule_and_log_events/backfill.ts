// Backfill de HabitSchedule pros hábitos criados antes desta migration.
// Não roda automaticamente (Prisma não executa .ts em migrations).
// A lógica mora em src/scripts/habitScheduleBackfill.ts e usa o timezone
// do dono (issue #23). Disparo manual: npm run backfill:schedules
// Roteiro: doc-2/guides/backfill-habit-schedule.md
import "../../../src/scripts/backfill-habit-schedules";
