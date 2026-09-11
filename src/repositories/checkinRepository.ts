import { prisma } from '../app';
import type { HabitSchedule } from '../generated/prisma/client';

// Único módulo que toca prisma.habitLog/prisma.graceFill/prisma.habitSchedule
// — enforced por src/__tests__/checkinRepositoryBoundary.test.ts.

type LogEvent = { date: Date; kind: 'CHECKIN' | 'UNDO'; checkedAt: Date };

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

// ---------- resolução de schedule por dia ----------

function coversDay(version: HabitSchedule, day: Date): boolean {
    return (
        version.effectiveFrom.getTime() <= day.getTime() &&
        (version.effectiveTo === null || version.effectiveTo.getTime() >= day.getTime())
    );
}

// DAILY sempre é dia-alvo; WEEKLY olha o dia da semana; INTERVAL conta
// dias corridos desde que a versão passou a valer.
export function isTargetDay(version: HabitSchedule, day: Date): boolean {
    if (version.type === 'DAILY') return true;
    if (version.type === 'WEEKLY') return version.daysOfWeek.includes(day.getUTCDay());

    const elapsedDays = Math.round((day.getTime() - version.effectiveFrom.getTime()) / 86_400_000);
    return elapsedDays >= 0 && elapsedDays % (version.intervalDays ?? 1) === 0;
}

// versão que vale pra um dia D: dentre as que cobrem D, a que começou
// mais recentemente. Normalmente só uma versão cobre D; mais de uma
// significa que D teve mais de uma edição de schedule antes de fechar.
function lastVersionCovering(schedules: HabitSchedule[], day: Date): HabitSchedule | null {
    const covering = schedules.filter((v) => coversDay(v, day));
    if (covering.length === 0) return null;
    return covering.reduce((latest, v) => (v.effectiveFromAt > latest.effectiveFromAt ? v : latest));
}

// dentre as versões que cobriram D, a mais recente que ainda incluía D
// como dia-alvo — usada só quando a versão vigente ao fim de D não
// inclui mais D (selamento: tranca no estado de antes dela sair do alvo).
function lastTargetingVersion(schedules: HabitSchedule[], day: Date): HabitSchedule | null {
    const targeting = schedules.filter((v) => coversDay(v, day) && isTargetDay(v, day));
    if (targeting.length === 0) return null;
    return targeting.reduce((latest, v) => (v.effectiveFromAt > latest.effectiveFromAt ? v : latest));
}

function netCountOnDay(events: LogEvent[], day: Date, until?: Date): number {
    return events.reduce((count, e) => {
        if (e.date.getTime() !== day.getTime()) return count;
        if (until && e.checkedAt.getTime() > until.getTime()) return count;
        return count + (e.kind === 'CHECKIN' ? 1 : -1);
    }, 0);
}

// completed(D): a versão que vale ao fim de D define o alvo. Se D
// continua sendo dia-alvo por ela, reprojeta contra esse alvo (o dia
// inteiro); se D saiu do alvo, tranca no estado acumulado até o
// instante em que a última versão que ainda incluía D deixou de valer.
function isCompleted(schedules: HabitSchedule[], events: LogEvent[], day: Date): boolean {
    const current = lastVersionCovering(schedules, day);
    if (!current) return false;

    if (isTargetDay(current, day)) {
        return netCountOnDay(events, day) >= current.targetPerDay;
    }

    const sealed = lastTargetingVersion(schedules, day);
    if (!sealed) return false;

    return netCountOnDay(events, day, sealed.effectiveToAt ?? undefined) >= sealed.targetPerDay;
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

// dias-alvo estritamente entre from e to (exclusive nas duas pontas) —
// usado pra saber se duas entradas da streak são contíguas (nenhum
// dia-alvo pulado no meio) e pra achar o dia exato de um gap de 1
// dia-alvo (grace period). Pura — recebe schedules já buscado.
export function targetDaysBetween(schedules: HabitSchedule[], from: Date, to: Date): Date[] {
    const result: Date[] = [];
    let cursor = new Date(from.getTime() + 86_400_000);
    while (cursor.getTime() < to.getTime()) {
        const version = lastVersionCovering(schedules, cursor);
        if (version && isTargetDay(version, cursor)) result.push(cursor);
        cursor = new Date(cursor.getTime() + 86_400_000);
    }
    return result;
}
