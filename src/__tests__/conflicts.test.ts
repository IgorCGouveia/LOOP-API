import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import Fastify from "fastify";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { prisma } from "../db";
import { errorHandler } from "../Middleware/errorHandler";
import { Prisma } from "../generated/prisma";

// issue #18: cada constraint tem a própria resposta; P2025 vira 404.
describe("errorHandler: erros conhecidos do Prisma", () => {
    function knownError(code: string, meta: Record<string, unknown>) {
        return new Prisma.PrismaClientKnownRequestError("erro de teste", { code, clientVersion: "test", meta });
    }

    async function responseFor(error: Error) {
        const app = Fastify();
        app.setErrorHandler(errorHandler);
        app.get("/boom", async () => {
            throw error;
        });
        const res = await app.inject({ method: "GET", url: "/boom" });
        await app.close();
        return { status: res.statusCode, body: res.json() };
    }

    it("P2002 em User.email mantém a mensagem de email", async () => {
        expect(await responseFor(knownError("P2002", { modelName: "User", target: ["email"] }))).toEqual({
            status: 409,
            body: { error: "Email já cadastrado." },
        });
    });

    it.each([
        ["GraceFill", ["habitId", "date"]],
        ["HabitLog", ["undoesId"]],
    ])("P2002 em %s vira conflito de operação simultânea no hábito", async (modelName, target) => {
        const { status, body } = await responseFor(knownError("P2002", { modelName, target }));
        expect(status).toBe(409);
        expect(body.error).toBe("Outra operação no mesmo hábito terminou antes desta. Tente de novo.");
    });

    it("P2002 em qualquer outro unique vira 409 genérico", async () => {
        expect(await responseFor(knownError("P2002", { modelName: "RefreshToken", target: ["tokenHash"] }))).toEqual({
            status: 409,
            body: { error: "Registro duplicado." },
        });
    });

    it("P2025 vira 404", async () => {
        expect(await responseFor(knownError("P2025", { modelName: "Habit", cause: "No record was found for a delete." }))).toEqual({
            status: 404,
            body: { error: "Registro não encontrado." },
        });
    });
});

describe("requisições paralelas no mesmo hábito", () => {
    let app: FastifyInstance;
    let userId: string;
    let token: string;
    const auth = () => ({ authorization: `Bearer ${token}` });

    beforeAll(async () => {
        app = buildApp();
        await app.ready();
        const user = await prisma.user.create({
            data: { name: "Usuário Conflitos", email: `conflicts-${Date.now()}@example.com`, password: "hash-fake", timezone: "America/Sao_Paulo" },
        });
        userId = user.id;
        token = jwt.sign({ id: userId, role: "USER" }, process.env.SECRET_KEY as string, { expiresIn: "3650d" });
    });

    afterEach(() => vi.useRealTimers());

    afterAll(async () => {
        await prisma.habit.deleteMany({ where: { userId } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
        await app.close();
        await prisma.$disconnect();
    });

    it("dois check-ins paralelos com 1 dia pulado: os dois gravam e o token é gasto uma vez só", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-11-16T15:00:00.000Z"));
        const created = await app.inject({
            method: "POST",
            url: "/habits",
            headers: auth(),
            payload: { name: "Paralelo", schedule: { type: "DAILY", targetPerDay: 2 } },
        });
        const habitId = created.json().data.id as string;
        await app.inject({ method: "POST", url: `/habits/${habitId}/checkin`, headers: auth() });
        await app.inject({ method: "POST", url: `/habits/${habitId}/checkin`, headers: auth() });

        vi.setSystemTime(new Date("2026-11-18T15:00:00.000Z"));
        const responses = await Promise.all([
            app.inject({ method: "POST", url: `/habits/${habitId}/checkin`, headers: auth() }),
            app.inject({ method: "POST", url: `/habits/${habitId}/checkin`, headers: auth() }),
        ]);

        for (const res of responses) {
            expect(res.body).not.toContain("Email já cadastrado.");
            expect(res.statusCode).toBe(201);
        }
        expect(await prisma.habitLog.count({ where: { habitId, kind: "CHECKIN", date: new Date("2026-11-18T00:00:00.000Z") } })).toBe(2);
        expect(await prisma.graceFill.count({ where: { habitId } })).toBe(1);
        const habit = await prisma.habit.findUniqueOrThrow({ where: { id: habitId } });
        expect(habit.graceTokens).toBe(0);
    });

    it("dois DELETE paralelos no mesmo hábito: um apaga, o outro recebe 404", async () => {
        const created = await app.inject({ method: "POST", url: "/habits", headers: auth(), payload: { name: "Apagar 2x" } });
        const habitId = created.json().data.id as string;

        const responses = await Promise.all([
            app.inject({ method: "DELETE", url: `/habits/${habitId}`, headers: auth() }),
            app.inject({ method: "DELETE", url: `/habits/${habitId}`, headers: auth() }),
        ]);

        expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 404]);
    });
});
