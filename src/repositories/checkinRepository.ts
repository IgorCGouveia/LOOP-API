import { prisma } from '../db';
import type { HabitSchedule } from '../generated/prisma/client';
import { isCompleted } from '../domain/schedule';

// Único módulo que toca prisma.habitLog/prisma.graceFill/prisma.habitSchedule
// — enforced por src/__tests__/checkinRepositoryBoundary.test.ts.

// ---------- eventos (HabitLog) ----------

export async function insertLogEvent(
    habitId: string,
    date: Date,
    kind: 'CHECKIN' | 'UNDO',
    undoesId?: string,
) {
    return prisma.habitLog.create({ data: { habitId, date, kind, undoesId } });
}

// CHECKIN mais recente que ainda não foi desfeito (sem UNDO apontando pra ele).
export async function findUndoableCheckIn(habitId: string) {
    return prisma.habitLog.findFirst({
        where: { habitId, kind: 'CHECKIN', undoneBy: null },
        orderBy: { checkedAt: 'desc' },
    });
}

// só eventos efetivos — um check-in desfeito não aparece na listagem,
// mesmo continuando no banco pra fins de streak.
export async function findCheckInsByHabit(habitId: string) {
    return prisma.habitLog.findMany({
        where: { habitId, kind: 'CHECKIN', undoneBy: null },
        orderBy: { date: 'desc' },
    });
}

export async function findCheckInsByUser(userId: string) {
    return prisma.habitLog.findMany({
        where: { habit: { userId }, kind: 'CHECKIN', undoneBy: null },
        orderBy: { date: 'desc' },
    });
}

export async function getNetCountOnDay(habitId: string, day: Date): Promise<number> {
    const [checkins, undos] = await Promise.all([
        prisma.habitLog.count({ where: { habitId, date: day, kind: 'CHECKIN' } }),
        prisma.habitLog.count({ where: { habitId, date: day, kind: 'UNDO' } }),
    ]);
    return checkins - undos;
}

export async function insertGraceFill(habitId: string, date: Date) {
    return prisma.graceFill.create({ data: { habitId, date } });
}

// ---------- schedule ----------

export async function getScheduleVersions(habitId: string): Promise<HabitSchedule[]> {
    return prisma.habitSchedule.findMany({
        where: { habitId },
        orderBy: { effectiveFromAt: 'asc' },
    });
}

export async function getCurrentSchedule(habitId: string): Promise<HabitSchedule | null> {
    return prisma.habitSchedule.findFirst({ where: { habitId, effectiveTo: null } });
}

// evita N+1 quando uma listagem de hábitos precisa do schedule de cada um.
export async function getCurrentSchedules(habitIds: string[]): Promise<Map<string, HabitSchedule>> {
    const rows = await prisma.habitSchedule.findMany({
        where: { habitId: { in: habitIds }, effectiveTo: null },
    });
    return new Map(rows.map((r) => [r.habitId, r]));
}

export type ScheduleInput = {
    type: 'DAILY' | 'WEEKLY' | 'INTERVAL';
    targetPerDay: number;
    daysOfWeek?: number[];
    intervalDays?: number;
};

// edição sempre cria uma versão nova e fecha a vigente — nunca UPDATE no
// lugar, mesmo se os valores forem idênticos a uma versão anterior
// (decisão de 04/09: sempre aceita o corte, sem detectar reversão).
// `today` é o dia local de quem edita (timezone do dono do hábito).
export async function createScheduleVersion(habitId: string, data: ScheduleInput, today: Date) {
    const now = new Date();

    return prisma.$transaction(async (tx) => {
        await tx.habitSchedule.updateMany({
            where: { habitId, effectiveTo: null },
            data: { effectiveTo: today, effectiveToAt: now },
        });

        return tx.habitSchedule.create({
            data: {
                habitId,
                type: data.type,
                targetPerDay: data.targetPerDay,
                daysOfWeek: data.daysOfWeek ?? [],
                intervalDays: data.intervalDays,
                effectiveFrom: today,
                effectiveFromAt: now,
            },
        });
    });
}

/**
 * Lista, em ordem ascendente e sem duplicata, todos os dias que contam
 * pro cálculo de streak de um hábito — dias com completed(D) verdadeiro,
 * unidos aos dias perdoados por token (GraceFill). `schedules`, se já
 * tiver sido buscado por quem chama, evita uma query repetida.
 */
export async function getEffectiveLog(habitId: string, schedules?: HabitSchedule[]): Promise<Date[]> {
    const [events, resolvedSchedules, graceFills] = await Promise.all([
        prisma.habitLog.findMany({ where: { habitId }, select: { date: true, kind: true, checkedAt: true } }),
        schedules ? Promise.resolve(schedules) : getScheduleVersions(habitId),
        prisma.graceFill.findMany({ where: { habitId }, select: { date: true } }),
    ]);

    const daysWithEvents = new Map<number, Date>();
    for (const e of events) daysWithEvents.set(e.date.getTime(), e.date);

    const completedDays = Array.from(daysWithEvents.values()).filter((day) =>
        isCompleted(resolvedSchedules, events, day),
    );

    const uniqueDates = new Map<number, Date>();
    for (const day of completedDays) uniqueDates.set(day.getTime(), day);
    for (const fill of graceFills) uniqueDates.set(fill.date.getTime(), fill.date);

    return Array.from(uniqueDates.values()).sort((a, b) => a.getTime() - b.getTime());
}
