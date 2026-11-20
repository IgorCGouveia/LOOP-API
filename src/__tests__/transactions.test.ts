import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { prisma } from "../db";
import * as checkinRepository from "../repositories/checkinRepository";

// Falha injetada no meio de cada caso de uso (issues #16, #19, #20,
// ADR-0003). O mock é parcial: as funções reais continuam rodando, e cada
// teste troca uma chamada só por um erro.
vi.mock("../repositories/checkinRepository", async (importOriginal) => {
    const real = await importOriginal<typeof import("../repositories/checkinRepository")>();
    return {
        ...real,
        createScheduleVersion: vi.fn(real.createScheduleVersion),
        insertLogEvent: vi.fn(real.insertLogEvent),
        getEffectiveLog: vi.fn(real.getEffectiveLog),
        getNetCountOnDay: vi.fn(real.getNetCountOnDay),
    };
});

const repo = vi.mocked(checkinRepository);
const injected = () => new Error("falha injetada");

// segunda / quarta em São Paulo (12:00 local). A terça fica sem check-in,
// então o check-in de quarta gasta o grace token.
const MONDAY = new Date("2026-11-16T15:00:00.000Z");
const WEDNESDAY = new Date("2026-11-18T15:00:00.000Z");

describe("unidade de trabalho: falha no meio não deixa escrita parcial", () => {
    let app: FastifyInstance;
    let userId: string;
    let token: string;
    const auth = () => ({ authorization: `Bearer ${token}` });

    async function snapshot(habitId: string) {
        const [habit, logs, graceFills, schedules] = await Promise.all([
            prisma.habit.findUnique({
                where: { id: habitId },
                select: { graceTokens: true, graceTokensUpdatedAt: true, longestStreak: true, longestStreakStartDate: true },
            }),
            prisma.habitLog.findMany({ where: { habitId }, orderBy: { checkedAt: "asc" } }),
            prisma.graceFill.findMany({ where: { habitId }, orderBy: { date: "asc" } }),
            prisma.habitSchedule.findMany({ where: { habitId }, orderBy: { effectiveFromAt: "asc" } }),
        ]);
        return { habit, logs, graceFills, schedules };
    }

    // hábito criado na segunda com check-in na segunda, relógio parado na
    // quarta: o próximo check-in tem 1 dia-alvo pulado e gasta 1 token.
    async function habitWithOneDayGap(name: string) {
        vi.setSystemTime(MONDAY);
        const created = await app.inject({ method: "POST", url: "/habits", headers: auth(), payload: { name } });
        expect(created.statusCode).toBe(201);
        const habitId = created.json().data.id as string;

        const monday = await app.inject({ method: "POST", url: `/habits/${habitId}/checkin`, headers: auth() });
        expect(monday.statusCode).toBe(201);

        vi.setSystemTime(WEDNESDAY);
        return habitId;
    }

    beforeAll(async () => {
        app = buildApp();
        await app.ready();

        const user = await prisma.user.create({
            data: {
                name: "Usuário Transações",
                email: `tx-${Date.now()}@example.com`,
                password: "hash-fake",
                timezone: "America/Sao_Paulo",
            },
        });
        userId = user.id;
        token = jwt.sign({ id: userId, role: "USER" }, process.env.SECRET_KEY as string, { expiresIn: "3650d" });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    afterAll(async () => {
        await prisma.habit.deleteMany({ where: { userId } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
        await app.close();
        await prisma.$disconnect();
    });

    it("POST /habits: se a 1ª versão do schedule falha, o hábito também não é gravado", async () => {
        const before = await prisma.habit.count({ where: { userId } });
        repo.createScheduleVersion.mockRejectedValueOnce(injected());

        const res = await app.inject({ method: "POST", url: "/habits", headers: auth(), payload: { name: "Nunca existe" } });

        expect(res.statusCode).toBe(500);
        expect(await prisma.habit.count({ where: { userId } })).toBe(before);
    });

    it("PATCH /habits/:id: se a nova versão do schedule falha, o nome também não muda", async () => {
        const created = await app.inject({ method: "POST", url: "/habits", headers: auth(), payload: { name: "Nome original" } });
        const habitId = created.json().data.id as string;
        repo.createScheduleVersion.mockRejectedValueOnce(injected());

        const res = await app.inject({
            method: "PATCH",
            url: `/habits/${habitId}`,
            headers: auth(),
            payload: { name: "Nome novo", schedule: { type: "WEEKLY", targetPerDay: 1, daysOfWeek: [1, 3] } },
        });

        expect(res.statusCode).toBe(500);
        const stored = await prisma.habit.findUnique({ where: { id: habitId } });
        expect(stored?.name).toBe("Nome original");
        expect(await prisma.habitSchedule.count({ where: { habitId } })).toBe(1);
    });

    it("check-in: falha no insert do CHECKIN depois do grace fill não gasta token nem deixa GraceFill", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const habitId = await habitWithOneDayGap("Gap com falha no insert");
        const before = await snapshot(habitId);
        expect(before.habit?.graceTokens).toBe(1);

        repo.insertLogEvent.mockRejectedValueOnce(injected());
        const res = await app.inject({ method: "POST", url: `/habits/${habitId}/checkin`, headers: auth() });

        expect(res.statusCode).toBe(500);
        expect(await snapshot(habitId)).toEqual(before);
        expect(await prisma.graceFill.count({ where: { habitId } })).toBe(0);
    });

    it("check-in: falha depois de todas as escritas desfaz tudo, e repetir grava um CHECKIN só", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const habitId = await habitWithOneDayGap("Gap com falha no fim");
        const before = await snapshot(habitId);

        // última leitura do caso de uso, depois de grace fill, débito,
        // CHECKIN e longestStreak
        repo.getNetCountOnDay.mockRejectedValueOnce(injected());
        const failed = await app.inject({ method: "POST", url: `/habits/${habitId}/checkin`, headers: auth() });
        expect(failed.statusCode).toBe(500);
        expect(await snapshot(habitId)).toEqual(before);

        const retry = await app.inject({ method: "POST", url: `/habits/${habitId}/checkin`, headers: auth() });
        expect(retry.statusCode).toBe(201);
        expect(retry.json().data).toMatchObject({ currentStreak: 3, longestStreak: 3, graceTokens: 0 });
        expect(await prisma.habitLog.count({ where: { habitId, kind: "CHECKIN" } })).toBe(2);
        expect(await prisma.graceFill.count({ where: { habitId } })).toBe(1);
    });

    it("undo: falha depois do insert do UNDO não deixa o evento nem mexe no longestStreak", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const habitId = await habitWithOneDayGap("Undo com falha");
        const wednesday = await app.inject({ method: "POST", url: `/habits/${habitId}/checkin`, headers: auth() });
        expect(wednesday.statusCode).toBe(201);
        const before = await snapshot(habitId);

        // 1ª chamada (antes do UNDO) passa; a 2ª (depois do insert) falha
        repo.getEffectiveLog
            .mockImplementationOnce(vi.mocked(repo.getEffectiveLog).getMockImplementation()!)
            .mockRejectedValueOnce(injected());
        const res = await app.inject({ method: "DELETE", url: `/habits/${habitId}/checkin`, headers: auth() });

        expect(res.statusCode).toBe(500);
        expect(await snapshot(habitId)).toEqual(before);
    });
});
