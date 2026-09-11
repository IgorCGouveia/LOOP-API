import { prisma } from '../app';
import { FindHabit } from './habitServices';
import * as checkinRepository from '../repositories/checkinRepository';
import type { Habit, HabitSchedule } from '../generated/prisma/client';
import { getDateOnlyInTimezone } from '../utils/date';

const GRACE_TOKENS_CAP = 3;

type Contiguity = (earlier: Date, later: Date) => boolean;

// dois dias contam como contíguos pra streak se nenhum dia-alvo (pelo
// schedule vigente em cada dia do meio) foi pulado entre eles — não é
// mais "exatamente 1 dia de calendário", porque WEEKLY/INTERVAL têm
// dias-alvo não-adjacentes no calendário.
function buildContiguity(schedules: HabitSchedule[]): Contiguity {
    return (earlier, later) => checkinRepository.targetDaysBetween(schedules, earlier, later).length === 0;
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
// mexe na sequência que hoje detém o longestStreak (ver docs/problems).
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

async function replenishGraceTokens(habit: Habit): Promise<number> {
    const now = new Date();
    const elapsed = monthsElapsedUTC(habit.graceTokensUpdatedAt, now);

    if (elapsed <= 0) {
        return habit.graceTokens;
    }

    const newBalance = Math.min(habit.graceTokens + elapsed, GRACE_TOKENS_CAP);
    await prisma.habit.update({
        where: { id: habit.id },
        data: { graceTokens: newBalance, graceTokensUpdatedAt: now },
    });

    return newBalance;
}

export async function CreateCheckIn(habitId: string, ownerId: string) {
    const habit = await FindHabit(habitId);
    if (!habit) {
        return null;
    }

    const owner = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner) {
        return null;
    }

    const today = getDateOnlyInTimezone(new Date(), owner.timezone);
    const schedules = await checkinRepository.getScheduleVersions(habitId);
    const isContiguous = buildContiguity(schedules);
    const currentSchedule = schedules.find((s) => s.effectiveTo === null) ?? null;

    const datesAscBefore = await checkinRepository.getEffectiveLog(habitId, schedules);
    const lastDate = datesAscBefore[datesAscBefore.length - 1] ?? null;

    let graceTokens = await replenishGraceTokens(habit);

    // gap de exatamente 1 dia-alvo pulado consome 1 token, gravando o
    // dia em GraceFill pra ele contar como contíguo em qualquer
    // recálculo futuro. Gap de 2+ dias-alvo não é perdoável.
    const skippedTargetDays = lastDate ? checkinRepository.targetDaysBetween(schedules, lastDate, today) : [];

    if (skippedTargetDays.length === 1 && graceTokens > 0) {
        await checkinRepository.insertGraceFill(habitId, skippedTargetDays[0]);
        graceTokens -= 1;
        await prisma.habit.update({ where: { id: habitId }, data: { graceTokens } });
    }

    const checkin = await checkinRepository.insertLogEvent(habitId, today, 'CHECKIN');

    const datesAsc = await checkinRepository.getEffectiveLog(habitId, schedules);
    const tail = computeTailStreak([...datesAsc].reverse(), isContiguous);
    const currentStreak = tail.length;

    let longestStreak = habit.longestStreak;
    let longestStreakStartDate = habit.longestStreakStartDate;

    if (currentStreak > habit.longestStreak) {
        longestStreak = currentStreak;
        longestStreakStartDate = tail.startDate;

        await prisma.habit.update({
            where: { id: habitId },
            data: { longestStreak, longestStreakStartDate },
        });
    }

    // com targetPerDay > 1, o currentStreak fica instável dentro do
    // dia — o 3º de 4 check-ins não fecha hoje, o 4º fecha.
    const todayCount = await checkinRepository.getNetCountOnDay(habitId, today);
    const todayProgress = currentSchedule ? { count: todayCount, target: currentSchedule.targetPerDay } : null;

    return { checkin, currentStreak, longestStreak, graceTokens, todayProgress };
}

export async function UndoCheckIn(habitId: string) {
    const habit = await FindHabit(habitId);
    if (!habit) {
        return null;
    }

    const lastLog = await checkinRepository.findUndoableCheckIn(habitId);
    if (!lastLog) {
        return null;
    }

    const schedules = await checkinRepository.getScheduleVersions(habitId);
    const isContiguous = buildContiguity(schedules);

    const tailBefore = computeTailStreak(
        [...(await checkinRepository.getEffectiveLog(habitId, schedules))].reverse(),
        isContiguous,
    );
    const undoAffectsRecord =
        habit.longestStreakStartDate !== null &&
        tailBefore.startDate !== null &&
        tailBefore.startDate.getTime() === habit.longestStreakStartDate.getTime();

    // undo é um evento novo (kind: UNDO), não apaga o CHECKIN original.
    await checkinRepository.insertLogEvent(habitId, lastLog.date, 'UNDO', lastLog.id);

    const currentStreak = computeTailStreak(
        [...(await checkinRepository.getEffectiveLog(habitId, schedules))].reverse(),
        isContiguous,
    ).length;

    let longestStreak = habit.longestStreak;
    let longestStreakStartDate = habit.longestStreakStartDate;

    if (undoAffectsRecord) {
        const recalculated = recalculateLongestStreak(
            await checkinRepository.getEffectiveLog(habitId, schedules),
            isContiguous,
        );
        longestStreak = recalculated.length;
        longestStreakStartDate = recalculated.startDate;

        await prisma.habit.update({
            where: { id: habitId },
            data: { longestStreak, longestStreakStartDate },
        });
    }

    return { currentStreak, longestStreak };
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
