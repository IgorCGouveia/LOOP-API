import { describe, it, expect } from "vitest";
import type { HabitSchedule } from "../generated/prisma/client";
import {
    GRACE_TOKENS_CAP,
    buildContiguity,
    computeTailStreak,
    monthsElapsedUTC,
    recalculateLongestStreak,
    replenishedGraceBalance,
} from "../domain/streak";

// Regras puras de streak e grace token (src/domain/streak.ts), sem banco.
// O caminho de ponta a ponta está em graceFillUndo.test.ts e
// habitScheduleAndGrace.test.ts.
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const days = (...isos: string[]) => isos.map(day);

function version(overrides: Partial<HabitSchedule>): HabitSchedule {
    return {
        id: "sched-1",
        habitId: "habit-1",
        effectiveFrom: day("2026-01-01"),
        effectiveFromAt: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: null,
        effectiveToAt: null,
        targetPerDay: 1,
        type: "DAILY",
        daysOfWeek: [],
        intervalDays: null,
        ...overrides,
    } as HabitSchedule;
}

const daily = buildContiguity([version({ type: "DAILY" })]);
// Seg, Qua, Sex
const mwf = buildContiguity([version({ type: "WEEKLY", daysOfWeek: [1, 3, 5] })]);

describe("buildContiguity", () => {
    it("DAILY: dias seguidos são contíguos, um dia de buraco não", () => {
        expect(daily(day("2026-03-02"), day("2026-03-03"))).toBe(true);
        expect(daily(day("2026-03-02"), day("2026-03-04"))).toBe(false);
    });

    it("WEEKLY: Seg -> Qua é contíguo (Ter não é dia-alvo), Seg -> Sex não (pulou Qua)", () => {
        expect(mwf(day("2026-03-02"), day("2026-03-04"))).toBe(true);
        expect(mwf(day("2026-03-02"), day("2026-03-06"))).toBe(false);
    });

    it("WEEKLY: Sex -> Seg seguinte é contíguo (fim de semana fora da agenda)", () => {
        expect(mwf(day("2026-03-06"), day("2026-03-09"))).toBe(true);
    });
});

describe("computeTailStreak (datas em ordem decrescente)", () => {
    it("log vazio: 0, sem data de início", () => {
        expect(computeTailStreak([], daily)).toEqual({ length: 0, startDate: null });
    });

    it("um dia só: 1, começando nele", () => {
        expect(computeTailStreak(days("2026-03-05"), daily)).toEqual({ length: 1, startDate: day("2026-03-05") });
    });

    it("conta só a sequência mais recente e para no primeiro buraco", () => {
        const desc = days("2026-03-10", "2026-03-09", "2026-03-08", "2026-03-05", "2026-03-04");
        expect(computeTailStreak(desc, daily)).toEqual({ length: 3, startDate: day("2026-03-08") });
    });

    it("WEEKLY: Seg/Qua/Sex/Seg seguidos contam 4", () => {
        const desc = days("2026-03-09", "2026-03-06", "2026-03-04", "2026-03-02");
        expect(computeTailStreak(desc, mwf).length).toBe(4);
    });
});

describe("recalculateLongestStreak (datas em ordem crescente)", () => {
    it("log vazio: 0", () => {
        expect(recalculateLongestStreak([], daily)).toEqual({ length: 0, startDate: null });
    });

    it("acha a maior sequência mesmo que não seja a última", () => {
        const asc = days("2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-10", "2026-03-11");
        expect(recalculateLongestStreak(asc, daily)).toEqual({ length: 4, startDate: day("2026-03-01") });
    });

    it("empate: fica com a primeira sequência (só troca quando é estritamente maior)", () => {
        const asc = days("2026-03-01", "2026-03-02", "2026-03-10", "2026-03-11");
        expect(recalculateLongestStreak(asc, daily)).toEqual({ length: 2, startDate: day("2026-03-01") });
    });

    it("nenhum dia seguido: 1, começando no primeiro", () => {
        const asc = days("2026-03-01", "2026-03-05", "2026-03-09");
        expect(recalculateLongestStreak(asc, daily)).toEqual({ length: 1, startDate: day("2026-03-01") });
    });
});

describe("monthsElapsedUTC", () => {
    it.each([
        ["mesmo mês", "2026-11-01T00:00:00Z", "2026-11-30T23:59:59Z", 0],
        ["mês seguinte, mesmo que só 1 dia depois", "2026-11-30T23:00:00Z", "2026-12-01T00:00:00Z", 1],
        ["virada de ano", "2026-12-15T00:00:00Z", "2027-01-02T00:00:00Z", 1],
        ["14 meses", "2026-01-10T00:00:00Z", "2027-03-01T00:00:00Z", 14],
        ["data no futuro (relógio voltou)", "2026-12-01T00:00:00Z", "2026-11-01T00:00:00Z", -1],
    ])("%s", (_caso, from, to, expected) => {
        expect(monthsElapsedUTC(new Date(from), new Date(to))).toBe(expected);
    });

    it("usa o mês em UTC, não o local: 31/10 23h em São Paulo já é novembro em UTC", () => {
        // 2026-11-01T02:00Z = 2026-10-31 23:00 em São Paulo
        expect(monthsElapsedUTC(new Date("2026-10-15T12:00:00Z"), new Date("2026-11-01T02:00:00Z"))).toBe(1);
    });
});

describe("replenishedGraceBalance", () => {
    const now = new Date("2026-11-20T12:00:00Z");

    it("mesmo mês: não muda e não precisa gravar", () => {
        expect(replenishedGraceBalance(1, new Date("2026-11-02T00:00:00Z"), now)).toEqual({ balance: 1, changed: false });
    });

    it("dois meses: +2", () => {
        expect(replenishedGraceBalance(0, new Date("2026-09-30T00:00:00Z"), now)).toEqual({ balance: 2, changed: true });
    });

    it(`não passa do teto (${GRACE_TOKENS_CAP})`, () => {
        expect(replenishedGraceBalance(2, new Date("2025-01-01T00:00:00Z"), now)).toEqual({ balance: GRACE_TOKENS_CAP, changed: true });
    });

    it("já no teto, mês novo: saldo igual, mas grava para avançar a data de reposição", () => {
        expect(replenishedGraceBalance(3, new Date("2026-10-01T00:00:00Z"), now)).toEqual({ balance: 3, changed: true });
    });

    it("data de reposição no futuro não tira token", () => {
        expect(replenishedGraceBalance(2, new Date("2027-01-01T00:00:00Z"), now)).toEqual({ balance: 2, changed: false });
    });
});
