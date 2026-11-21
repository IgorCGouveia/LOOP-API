import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { prisma } from "../db";
import { bearer, createHabit, createUser, deleteUsers, signRaw, type TestUser } from "./helpers/factories";

// PATCH /habits/:id com schedule (versionamento pelo HTTP) e a reposição
// mensal de grace token no check-in. A lógica pura de schedule está em
// scheduleLogic.test.ts e pathA.test.ts; aqui é o caminho de ponta a ponta.
describe("Hábitos: edição de schedule e reposição de grace token", () => {
    let app: FastifyInstance;
    let owner: TestUser;

    const patch = (id: string, payload: object) =>
        app.inject({ method: "PATCH", url: `/habits/${id}`, headers: bearer(owner.token), payload });
    const versions = (habitId: string) =>
        prisma.habitSchedule.findMany({ where: { habitId }, orderBy: { effectiveFromAt: "asc" } });

    beforeAll(async () => {
        app = buildApp();
        await app.ready();
        owner = await createUser({ prefix: "schedule-grace" });
    });

    afterEach(() => vi.useRealTimers());

    afterAll(async () => {
        await deleteUsers([owner?.id]);
        await app.close();
        await prisma.$disconnect();
    });

    describe("PATCH /habits/:id com schedule", () => {
        it("cria uma versão nova, fecha a anterior e devolve o schedule vigente", async () => {
            const habit = await createHabit(owner.id, { name: "Correr" });

            const res = await patch(habit.id, { schedule: { type: "WEEKLY", targetPerDay: 1, daysOfWeek: [1, 3, 5] } });
            expect(res.statusCode).toBe(200);
            expect(res.json().data.schedule).toMatchObject({ type: "WEEKLY", daysOfWeek: [1, 3, 5], effectiveTo: null });

            const [first, second] = await versions(habit.id);
            expect(first.type).toBe("DAILY");
            expect(first.effectiveTo).not.toBeNull();
            expect(second.type).toBe("WEEKLY");
            expect(second.effectiveTo).toBeNull();

            const list = await app.inject({ method: "GET", url: "/me/habits", headers: bearer(owner.token) });
            const listed = list.json().data.find((h: { id: string }) => h.id === habit.id);
            expect(listed.schedule.type).toBe("WEEKLY");
        });

        it("nome e schedule no mesmo PATCH mudam juntos", async () => {
            const habit = await createHabit(owner.id, { name: "Ler livro" });

            const res = await patch(habit.id, {
                name: "Ler 20 páginas",
                schedule: { type: "INTERVAL", targetPerDay: 1, intervalDays: 2 },
            });
            expect(res.statusCode).toBe(200);
            expect(res.json().data).toMatchObject({ name: "Ler 20 páginas", schedule: { type: "INTERVAL", intervalDays: 2 } });
        });

        it.each([
            ["WEEKLY sem daysOfWeek", { type: "WEEKLY", targetPerDay: 1 }],
            ["WEEKLY com daysOfWeek vazio", { type: "WEEKLY", targetPerDay: 1, daysOfWeek: [] }],
            ["dia da semana fora de 0-6", { type: "WEEKLY", targetPerDay: 1, daysOfWeek: [7] }],
            ["INTERVAL sem intervalDays", { type: "INTERVAL", targetPerDay: 1 }],
            ["targetPerDay zero", { type: "DAILY", targetPerDay: 0 }],
            ["targetPerDay fracionado", { type: "DAILY", targetPerDay: 1.5 }],
            ["tipo desconhecido", { type: "MONTHLY", targetPerDay: 1 }],
        ])("schedule inválido (%s) -> 400 e nenhuma versão nova", async (_caso, schedule) => {
            const habit = await createHabit(owner.id, { name: "Validação de schedule" });

            const res = await patch(habit.id, { schedule });
            expect(res.statusCode).toBe(400);
            expect(await versions(habit.id)).toHaveLength(1);
        });

        it("userId no corpo é ignorado: o dono do hábito não muda", async () => {
            const intruder = await createUser({ prefix: "schedule-grace-intruder" });
            try {
                const habit = await createHabit(owner.id, { name: "Dono fixo" });

                const res = await patch(habit.id, { name: "Dono fixo 2", userId: intruder.id });
                expect(res.statusCode).toBe(200);

                const stored = await prisma.habit.findUniqueOrThrow({ where: { id: habit.id } });
                expect(stored.userId).toBe(owner.id);
            } finally {
                await deleteUsers([intruder.id]);
            }
        });
    });

    describe("reposição de grace token (+1 por mês de calendário UTC, teto 3)", () => {
        async function checkinAt(isoInstant: string, setup: { graceTokens: number; updatedAt: string }) {
            const habit = await createHabit(owner.id, { name: "Grace" });
            await prisma.habit.update({
                where: { id: habit.id },
                data: { graceTokens: setup.graceTokens, graceTokensUpdatedAt: new Date(setup.updatedAt) },
            });

            // o token de 1h do factory expiraria com o relógio adiantado
            const longLived = signRaw({ id: owner.id, role: "USER" }, { expiresIn: "3650d" });

            vi.useFakeTimers({ toFake: ["Date"] });
            vi.setSystemTime(new Date(isoInstant));

            const res = await app.inject({ method: "POST", url: `/habits/${habit.id}/checkin`, headers: bearer(longLived) });
            expect(res.statusCode).toBe(201);
            const stored = await prisma.habit.findUniqueOrThrow({ where: { id: habit.id } });
            return { response: res.json().data, stored };
        }

        it("dois meses depois, com saldo 0, ganha 2", async () => {
            const { response, stored } = await checkinAt("2026-11-20T15:00:00.000Z", {
                graceTokens: 0,
                updatedAt: "2026-09-25T12:00:00.000Z",
            });
            expect(response.graceTokens).toBe(2);
            expect(stored.graceTokens).toBe(2);
            expect(stored.graceTokensUpdatedAt.toISOString()).toBe("2026-11-20T15:00:00.000Z");
        });

        it("não passa do teto de 3", async () => {
            const { response } = await checkinAt("2026-11-20T15:00:00.000Z", {
                graceTokens: 2,
                updatedAt: "2026-06-01T12:00:00.000Z",
            });
            expect(response.graceTokens).toBe(3);
        });

        it("virada de ano conta como mês (dez -> jan)", async () => {
            const { response } = await checkinAt("2027-01-02T15:00:00.000Z", {
                graceTokens: 0,
                updatedAt: "2026-12-30T12:00:00.000Z",
            });
            expect(response.graceTokens).toBe(1);
        });

        it("no mesmo mês não repõe nada e não mexe na data de reposição", async () => {
            const { response, stored } = await checkinAt("2026-11-20T15:00:00.000Z", {
                graceTokens: 1,
                updatedAt: "2026-11-01T12:00:00.000Z",
            });
            expect(response.graceTokens).toBe(1);
            expect(stored.graceTokensUpdatedAt.toISOString()).toBe("2026-11-01T12:00:00.000Z");
        });
    });
});
