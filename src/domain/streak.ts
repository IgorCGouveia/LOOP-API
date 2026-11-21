import type { HabitSchedule } from '../generated/prisma/client';
import { targetDaysBetween } from './schedule';

// Regras puras de streak e grace token: recebem datas e versões de
// schedule já buscadas e não tocam no banco. Saíram de checkinServices.ts
// pra poderem ser testadas sem Postgres (src/__tests__/streak.test.ts).

export const GRACE_TOKENS_CAP = 3;

export type Contiguity = (earlier: Date, later: Date) => boolean;

// dois dias contam como contíguos pra streak se nenhum dia-alvo (pelo
// schedule vigente em cada dia do meio) foi pulado entre eles — não é
// mais "exatamente 1 dia de calendário", porque WEEKLY/INTERVAL têm
// dias-alvo não-adjacentes no calendário.
export function buildContiguity(schedules: HabitSchedule[]): Contiguity {
    return (earlier, later) => targetDaysBetween(schedules, earlier, later).length === 0;
}

// streak atual: sem janela fixa, conta a sequência contígua mais recente
// (a "cauda" das datas distintas), pare no primeiro gap.
export function computeTailStreak(
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
export function recalculateLongestStreak(
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
export function monthsElapsedUTC(from: Date, to: Date): number {
    return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

// saldo de grace token depois da reposição mensal (+1 por mês de
// calendário UTC desde a última reposição, até o teto). `changed` diz se
// o saldo e a data de reposição precisam ser gravados.
export function replenishedGraceBalance(
    current: number,
    updatedAt: Date,
    now: Date,
): { balance: number; changed: boolean } {
    const elapsed = monthsElapsedUTC(updatedAt, now);
    if (elapsed <= 0) {
        return { balance: current, changed: false };
    }
    return { balance: Math.min(current + elapsed, GRACE_TOKENS_CAP), changed: true };
}
