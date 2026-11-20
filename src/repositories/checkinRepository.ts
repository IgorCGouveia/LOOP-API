import { prisma } from '../db';
import type { HabitSchedule, Prisma } from '../generated/prisma/client';
import { isCompleted } from '../domain/schedule';

// Único módulo que toca habitLog/graceFill/habitSchedule, seja pelo client
// global, seja pelo `tx` de uma transação — enforced por
// src/__tests__/checkinRepositoryBoundary.test.ts.
//
// Unidade de trabalho (issue #20): as funções que um caso de uso chama
// dentro de prisma.$transaction aceitam `db` no último parâmetro. Sem ele,
// usam o client global e cada chamada é um commit próprio, como antes.
export type Db = Prisma.TransactionClient;

// ---------- trava por hábito ----------

// SELECT ... FOR UPDATE na linha do hábito: serializa check-in e undo do
// mesmo hábito. Sem isso, duas requisições paralelas leem o mesmo log,
// as duas acham o mesmo dia pulado e uma delas bate no unique de
// GraceFill (issue #18). Só tem efeito dentro de uma transação.
export async function lockHabit(db: Db, habitId: string): Promise<void> {
    await db.$queryRaw`SELECT id FROM "Habit" WHERE id = ${habitId} FOR UPDATE`;
}

// ---------- eventos (HabitLog) ----------

export async function insertLogEvent(
    habitId: string,
    date: Date,
    kind: 'CHECKIN' | 'UNDO',
    undoesId?: string,
    db: Db = prisma,
) {
    return db.habitLog.create({ data: { habitId, date, kind, undoesId } });
}

// CHECKIN mais recente que ainda não foi desfeito (sem UNDO apontando pra ele).
export async function findUndoableCheckIn(habitId: string, db: Db = prisma) {
    return db.habitLog.findFirst({
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

export async function getNetCountOnDay(habitId: string, day: Date, db: Db = prisma): Promise<number> {
    const checkins = await db.habitLog.count({ where: { habitId, date: day, kind: 'CHECKIN' } });
    const undos = await db.habitLog.count({ where: { habitId, date: day, kind: 'UNDO' } });
    return checkins - undos;
}

// `checkinId` é o CHECKIN que gastou o token — é por ele que o undo acha
// o fill pra compensar (ADR-0004).
export async function insertGraceFill(habitId: string, date: Date, checkinId: string, db: Db = prisma) {
    return db.graceFill.create({ data: { habitId, date, checkinId } });
}

// apaga o grace fill criado por um CHECKIN, se houver. Devolve quantos
// apagou (0 ou 1): fills anteriores ao vínculo têm checkinId null e
// nunca são achados aqui.
export async function deleteGraceFillOfCheckIn(checkinId: string, db: Db = prisma): Promise<number> {
    const { count } = await db.graceFill.deleteMany({ where: { checkinId } });
    return count;
}

// ---------- schedule ----------

export async function getScheduleVersions(habitId: string, db: Db = prisma): Promise<HabitSchedule[]> {
    return db.habitSchedule.findMany({
        where: { habitId },
        orderBy: { effectiveFromAt: 'asc' },
    });
}

export async function getCurrentSchedule(habitId: string, db: Db = prisma): Promise<HabitSchedule | null> {
    return db.habitSchedule.findFirst({ where: { habitId, effectiveTo: null } });
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
// Com `db`, roda dentro da transação de quem chama; sem ele, abre uma
// própria (fechar a vigente e abrir a nova nunca podem se separar).
export async function createScheduleVersion(
    habitId: string,
    data: ScheduleInput,
    today: Date,
    db?: Db,
): Promise<HabitSchedule> {
    if (!db) {
        return prisma.$transaction((tx) => createScheduleVersion(habitId, data, today, tx));
    }

    const now = new Date();

    await db.habitSchedule.updateMany({
        where: { habitId, effectiveTo: null },
        data: { effectiveTo: today, effectiveToAt: now },
    });

    return db.habitSchedule.create({
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
}

// ---------- backfill de hábitos legados (src/scripts/habitScheduleBackfill.ts) ----------

// versão com instante explícito: o backfill usa o createdAt do hábito como
// effectiveFromAt, que é como a correção reconhece essas linhas depois.
export async function insertBackfilledScheduleVersion(
    habitId: string,
    data: ScheduleInput,
    effectiveFrom: Date,
    effectiveFromAt: Date,
    db: Db = prisma,
): Promise<HabitSchedule> {
    return db.habitSchedule.create({
        data: {
            habitId,
            type: data.type,
            targetPerDay: data.targetPerDay,
            daysOfWeek: data.daysOfWeek ?? [],
            intervalDays: data.intervalDays,
            effectiveFrom,
            effectiveFromAt,
        },
    });
}

export async function getFirstScheduleVersion(habitId: string, db: Db = prisma): Promise<HabitSchedule | null> {
    return db.habitSchedule.findFirst({ where: { habitId }, orderBy: { effectiveFromAt: 'asc' } });
}

export async function setScheduleEffectiveFrom(scheduleId: string, effectiveFrom: Date, db: Db = prisma) {
    return db.habitSchedule.update({ where: { id: scheduleId }, data: { effectiveFrom } });
}

/**
 * Lista, em ordem ascendente e sem duplicata, todos os dias que contam
 * pro cálculo de streak de um hábito — dias com completed(D) verdadeiro,
 * unidos aos dias perdoados por token (GraceFill). `schedules`, se já
 * tiver sido buscado por quem chama, evita uma query repetida.
 */
export async function getEffectiveLog(
    habitId: string,
    schedules?: HabitSchedule[],
    db: Db = prisma,
): Promise<Date[]> {
    // sequencial de propósito: dentro de uma transação interativa as
    // queries dividem uma conexão só, então Promise.all não ganha nada.
    const events = await db.habitLog.findMany({
        where: { habitId },
        select: { date: true, kind: true, checkedAt: true },
    });
    const resolvedSchedules = schedules ?? (await getScheduleVersions(habitId, db));
    const graceFills = await db.graceFill.findMany({ where: { habitId }, select: { date: true } });

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
