import { prisma } from "../db";
import * as checkinRepository from "../repositories/checkinRepository";
import type { Db } from "../repositories/checkinRepository";
import { getDateOnlyInTimezone } from "../utils/date";

// Backfill de HabitSchedule pros hábitos criados antes de 2026-09-04
// (migração 20260904120000_add_habit_schedule_and_log_events) e a
// correção das linhas que o backfill antigo datou em UTC (issue #23).
// Roteiro de uso: doc-2/guides/backfill-habit-schedule.md.

const LEGACY_SCHEDULE = { type: "DAILY" as const, targetPerDay: 1 };

// `userId` restringe a um usuário (rodar pra uma conta só, ou isolar um
// teste dos hábitos de outros testes rodando em paralelo).
export type BackfillScope = { userId?: string };

// 1ª versão de um hábito legado: começa no dia local do dono em que o
// hábito foi criado, igual ao CreateHabit. effectiveFromAt = createdAt é
// a assinatura que distingue uma linha de backfill de uma criada pela API
// (lá o instante é sempre um pouco depois do createdAt).
export async function backfillHabitSchedules(scope: BackfillScope = {}, db: Db = prisma): Promise<number> {
    const habits = await db.habit.findMany({
        where: { schedules: { none: {} }, userId: scope.userId },
        select: { id: true, createdAt: true, user: { select: { timezone: true } } },
    });

    for (const habit of habits) {
        await checkinRepository.insertBackfilledScheduleVersion(
            habit.id,
            LEGACY_SCHEDULE,
            getDateOnlyInTimezone(habit.createdAt, habit.user.timezone),
            habit.createdAt,
            db,
        );
    }

    return habits.length;
}

export type MisdatedSchedule = {
    scheduleId: string;
    habitId: string;
    timezone: string;
    oldEffectiveFrom: Date;
    newEffectiveFrom: Date;
};

// linhas gravadas pelo backfill antigo (effectiveFrom = dia UTC do
// createdAt) cujo dia local do dono é anterior. Só move pra trás: dia
// mais cedo só pode acrescentar dias completos, nunca tirar.
export async function findMisdatedBackfilledSchedules(
    scope: BackfillScope = {},
    db: Db = prisma,
): Promise<MisdatedSchedule[]> {
    const habits = await db.habit.findMany({
        where: { userId: scope.userId },
        select: { id: true, createdAt: true, user: { select: { timezone: true } } },
    });

    const result: MisdatedSchedule[] = [];
    for (const habit of habits) {
        const first = await checkinRepository.getFirstScheduleVersion(habit.id, db);
        if (!first || first.effectiveFromAt.getTime() !== habit.createdAt.getTime()) continue;

        const localDay = getDateOnlyInTimezone(habit.createdAt, habit.user.timezone);
        if (localDay.getTime() < first.effectiveFrom.getTime()) {
            result.push({
                scheduleId: first.id,
                habitId: habit.id,
                timezone: habit.user.timezone,
                oldEffectiveFrom: first.effectiveFrom,
                newEffectiveFrom: localDay,
            });
        }
    }
    return result;
}

// idempotente: depois de aplicado, nenhuma linha volta a ser achada.
export async function fixMisdatedBackfilledSchedules(rows: MisdatedSchedule[]): Promise<void> {
    await prisma.$transaction(async (tx) => {
        for (const row of rows) {
            await checkinRepository.setScheduleEffectiveFrom(row.scheduleId, row.newEffectiveFrom, tx);
        }
    });
}
