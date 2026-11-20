import { prisma } from '../db';
import * as checkinRepository from '../repositories/checkinRepository';
import type { Db } from '../repositories/checkinRepository';
import type { Habit, HabitSchedule } from '../generated/prisma/client';
import { getDateOnlyInTimezone } from '../utils/date';
import { targetDaysBetween } from '../domain/schedule';

const GRACE_TOKENS_CAP = 3;

type Contiguity = (earlier: Date, later: Date) => boolean;

// dois dias contam como contíguos pra streak se nenhum dia-alvo (pelo
// schedule vigente em cada dia do meio) foi pulado entre eles — não é
// mais "exatamente 1 dia de calendário", porque WEEKLY/INTERVAL têm
// dias-alvo não-adjacentes no calendário.
function buildContiguity(schedules: HabitSchedule[]): Contiguity {
    return (earlier, later) => targetDaysBetween(schedules, earlier, later).length === 0;
}

// streak atual: sem janela fixa, conta a sequência contígua mais recente
// (a "cauda" das datas distintas), pare no primeiro gap.
function computeTailStreak(
    datesDesc: Date[],
    isContiguous: Contiguity,
): { length: number; startDate: Date | null } {
    if (datesDesc.length === 0) {
        return { length: 0, startDate: null };
    }

    let length = 1;
    let startDate = datesDesc[0];

    for (let i = 1; i < datesDesc.length; i++) {
        if (isContiguous(datesDesc[i], datesDesc[i - 1])) {
            length++;
            startDate = datesDesc[i];
        } else {
            break;
        }
    }

    return { length, startDate };
}

// recorde histórico: varre o log inteiro. Só é chamado quando um undo
// mexe na sequência que hoje detém o longestStreak.
function recalculateLongestStreak(
    datesAsc: Date[],
    isContiguous: Contiguity,
): { length: number; startDate: Date | null } {
    if (datesAsc.length === 0) {
        return { length: 0, startDate: null };
    }

    let longest = 1;
    let longestStart = datesAsc[0];
    let runLength = 1;
    let runStart = datesAsc[0];

    for (let i = 1; i < datesAsc.length; i++) {
        if (isContiguous(datesAsc[i - 1], datesAsc[i])) {
            runLength++;
        } else {
            runLength = 1;
            runStart = datesAsc[i];
        }

        if (runLength > longest) {
            longest = runLength;
            longestStart = runStart;
        }
    }

    return { length: longest, startDate: longestStart };
}

// meses corridos (UTC) entre duas datas — usado só pra saber quantas
// reposições de grace token (+1/mês, calendário fixo) já eram devidas.
function monthsElapsedUTC(from: Date, to: Date): number {
    return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

async function replenishGraceTokens(habit: Habit, db: Db): Promise<number> {
    const now = new Date();
    const elapsed = monthsElapsedUTC(habit.graceTokensUpdatedAt, now);

    if (elapsed <= 0) {
        return habit.graceTokens;
    }

    const newBalance = Math.min(habit.graceTokens + elapsed, GRACE_TOKENS_CAP);
    await db.habit.update({
        where: { id: habit.id },
        data: { graceTokens: newBalance, graceTokensUpdatedAt: now },
    });

    return newBalance;
}

// Check-in e undo são uma unidade de trabalho cada (issue #16, ADR-0003):
// reposição de token, grace fill, débito do token, o evento no log e o
// longestStreak entram no mesmo commit, ou nenhum entra. Um 500 passa a
// significar "nada foi gravado", então o cliente pode repetir sem criar
// um CHECKIN duplicado. As leituras também acontecem dentro da transação,
// depois da trava na linha do hábito, pra duas requisições paralelas no
// mesmo hábito não calcularem a streak em cima do mesmo estado.
export async function CreateCheckIn(habitId: string, ownerId: string) {
    const owner = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner) {
        return null;
    }

    return prisma.$transaction(async (tx) => {
        await checkinRepository.lockHabit(tx, habitId);

        const habit = await tx.habit.findUnique({ where: { id: habitId } });
        if (!habit) {
            return null;
        }

        const today = getDateOnlyInTimezone(new Date(), owner.timezone);
        const schedules = await checkinRepository.getScheduleVersions(habitId, tx);
        const isContiguous = buildContiguity(schedules);
        const currentSchedule = schedules.find((s) => s.effectiveTo === null) ?? null;

        const datesAscBefore = await checkinRepository.getEffectiveLog(habitId, schedules, tx);
        const lastDate = datesAscBefore[datesAscBefore.length - 1] ?? null;

        let graceTokens = await replenishGraceTokens(habit, tx);

        // gap de exatamente 1 dia-alvo pulado consome 1 token, gravando o
        // dia em GraceFill pra ele contar como contíguo em qualquer
        // recálculo futuro. Gap de 2+ dias-alvo não é perdoável.
        const skippedTargetDays = lastDate ? targetDaysBetween(schedules, lastDate, today) : [];

        // o CHECKIN vem antes do fill pra o fill poder apontar pra ele —
        // é esse vínculo que deixa o undo devolver o token (ADR-0004).
        const checkin = await checkinRepository.insertLogEvent(habitId, today, 'CHECKIN', undefined, tx);

        if (skippedTargetDays.length === 1 && graceTokens > 0) {
            await checkinRepository.insertGraceFill(habitId, skippedTargetDays[0], checkin.id, tx);
            const debited = await tx.habit.update({
                where: { id: habitId },
                data: { graceTokens: { decrement: 1 } },
                select: { graceTokens: true },
            });
            graceTokens = debited.graceTokens;
        }

        const datesAsc = await checkinRepository.getEffectiveLog(habitId, schedules, tx);
        const tail = computeTailStreak([...datesAsc].reverse(), isContiguous);
        const currentStreak = tail.length;

        let longestStreak = habit.longestStreak;
        let longestStreakStartDate = habit.longestStreakStartDate;

        if (currentStreak > habit.longestStreak) {
            longestStreak = currentStreak;
            longestStreakStartDate = tail.startDate;

            await tx.habit.update({
                where: { id: habitId },
                data: { longestStreak, longestStreakStartDate },
            });
        }

        // com targetPerDay > 1, o currentStreak fica instável dentro do
        // dia — o 3º de 4 check-ins não fecha hoje, o 4º fecha.
        const todayCount = await checkinRepository.getNetCountOnDay(habitId, today, tx);
        const todayProgress = currentSchedule ? { count: todayCount, target: currentSchedule.targetPerDay } : null;

        return { checkin, currentStreak, longestStreak, graceTokens, todayProgress };
    });
}

export async function UndoCheckIn(habitId: string) {
    return prisma.$transaction(async (tx) => {
        await checkinRepository.lockHabit(tx, habitId);

        const habit = await tx.habit.findUnique({ where: { id: habitId } });
        if (!habit) {
            return null;
        }

        const lastLog = await checkinRepository.findUndoableCheckIn(habitId, tx);
        if (!lastLog) {
            return null;
        }

        const schedules = await checkinRepository.getScheduleVersions(habitId, tx);
        const isContiguous = buildContiguity(schedules);

        const tailBefore = computeTailStreak(
            [...(await checkinRepository.getEffectiveLog(habitId, schedules, tx))].reverse(),
            isContiguous,
        );
        const undoAffectsRecord =
            habit.longestStreakStartDate !== null &&
            tailBefore.startDate !== null &&
            tailBefore.startDate.getTime() === habit.longestStreakStartDate.getTime();

        // undo é um evento novo (kind: UNDO), não apaga o CHECKIN original.
        await checkinRepository.insertLogEvent(habitId, lastLog.date, 'UNDO', lastLog.id, tx);

        // se o CHECKIN desfeito gastou um token, o dia perdoado por ele sai
        // do log efetivo e o token volta (ADR-0004). Sem isso, o próximo
        // check-in enxerga só 1 dia pulado depois do fill órfão e perdoa
        // um gap de 2 dias-alvo com um 2º token (issue #21).
        const compensated = await checkinRepository.deleteGraceFillOfCheckIn(lastLog.id, tx);
        if (compensated > 0) {
            await tx.habit.update({
                where: { id: habitId },
                data: { graceTokens: Math.min(habit.graceTokens + 1, GRACE_TOKENS_CAP) },
            });
        }

        const datesAsc = await checkinRepository.getEffectiveLog(habitId, schedules, tx);
        const currentStreak = computeTailStreak([...datesAsc].reverse(), isContiguous).length;

        let longestStreak = habit.longestStreak;
        let longestStreakStartDate = habit.longestStreakStartDate;

        if (undoAffectsRecord) {
            const recalculated = recalculateLongestStreak(datesAsc, isContiguous);
            longestStreak = recalculated.length;
            longestStreakStartDate = recalculated.startDate;

            await tx.habit.update({
                where: { id: habitId },
                data: { longestStreak, longestStreakStartDate },
            });
        }

        return { currentStreak, longestStreak };
    });
}

// recorde recalculado do zero a partir do log efetivo. Só leitura — usado
// pela auditoria (src/scripts/audit-integrity.ts) pra achar longestStreak
// inflado por escritas parciais de antes da issue #16.
export async function RecomputeLongestStreak(habitId: string): Promise<number> {
    const schedules = await checkinRepository.getScheduleVersions(habitId);
    const datesAsc = await checkinRepository.getEffectiveLog(habitId, schedules);
    return recalculateLongestStreak(datesAsc, buildContiguity(schedules)).length;
}

export async function GetCheckInsByHabit(habitId: string) {
    return checkinRepository.findCheckInsByHabit(habitId);
}

export async function GetCheckInsByUser(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        return null;
    }

    return checkinRepository.findCheckInsByUser(userId);
}
