import { describe, it, expect } from "vitest";
import { isTargetDay, targetDaysBetween } from "../repositories/checkinRepository";
import type { HabitSchedule } from "../generated/prisma/client";

function day(iso: string): Date {
    return new Date(`${iso}T00:00:00.000Z`);
}

function makeVersion(overrides: Partial<HabitSchedule>): HabitSchedule {
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

describe("isTargetDay", () => {
    it("DAILY: todo dia é alvo", () => {
        const v = makeVersion({ type: "DAILY" });
        expect(isTargetDay(v, day("2026-03-04"))).toBe(true);
    });

    it("WEEKLY: só os dias da semana configurados (Seg=1, Qua=3, Sex=5)", () => {
        const v = makeVersion({ type: "WEEKLY", daysOfWeek: [1, 3, 5] });
        expect(isTargetDay(v, day("2026-03-02"))).toBe(true); // segunda
        expect(isTargetDay(v, day("2026-03-03"))).toBe(false); // terça
        expect(isTargetDay(v, day("2026-03-04"))).toBe(true); // quarta
    });

    it("INTERVAL: a cada N dias a partir de effectiveFrom", () => {
        const v = makeVersion({ type: "INTERVAL", intervalDays: 3, effectiveFrom: day("2026-03-01") });
        expect(isTargetDay(v, day("2026-03-01"))).toBe(true); // dia 0
        expect(isTargetDay(v, day("2026-03-02"))).toBe(false); // dia 1
        expect(isTargetDay(v, day("2026-03-04"))).toBe(true); // dia 3
        expect(isTargetDay(v, day("2026-03-05"))).toBe(false); // dia 4
    });
});

describe("targetDaysBetween — contiguidade de streak sob schedule não-diário", () => {
    it("WEEKLY: dias fora da agenda entre duas datas não contam como pulados", () => {
        const v = makeVersion({ type: "WEEKLY", daysOfWeek: [1, 3, 5], effectiveFrom: day("2026-03-01") });
        // segunda 02/03 -> quarta 04/03: só terça (03/03) no meio, que não é alvo
        const skipped = targetDaysBetween([v], day("2026-03-02"), day("2026-03-04"));
        expect(skipped).toEqual([]);
    });

    it("WEEKLY: um dia-alvo pulado no meio aparece na lista", () => {
        const v = makeVersion({ type: "WEEKLY", daysOfWeek: [1, 3, 5], effectiveFrom: day("2026-03-01") });
        // segunda 02/03 -> sexta 06/03: quarta (04/03) era alvo e não foi feita
        const skipped = targetDaysBetween([v], day("2026-03-02"), day("2026-03-06"));
        expect(skipped).toEqual([day("2026-03-04")]);
    });

    it("dia sem nenhuma versão cobrindo não quebra a checagem", () => {
        const v = makeVersion({
            type: "DAILY",
            effectiveFrom: day("2026-03-07"),
            effectiveFromAt: new Date("2026-03-07T00:00:00.000Z"),
        });
        // a versão só começa depois do intervalo inteiro — nenhum dia
        // entre 02/03 e 06/03 tem schedule cobrindo, não devem contar
        // como pulados
        const skipped = targetDaysBetween([v], day("2026-03-02"), day("2026-03-06"));
        expect(skipped).toEqual([]);
    });
});
