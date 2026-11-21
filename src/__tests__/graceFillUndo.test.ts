import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { prisma } from "../db";

// issue #21 / ADR-0010: desfazer o CHECKIN que gastou um grace token
// apaga o fill que ele criou e devolve o token.
const at = (iso: string) => new Date(`${iso}T15:00:00.000Z`); // 12:00 em São Paulo
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("undo de check-in que gastou grace token", () => {
    let app: FastifyInstance;
    let userId: string;
    let token: string;
    const auth = () => ({ authorization: `Bearer ${token}` });

    const checkin = (habitId: string) => app.inject({ method: "POST", url: `/habits/${habitId}/checkin`, headers: auth() });
    const undo = (habitId: string) => app.inject({ method: "DELETE", url: `/habits/${habitId}/checkin`, headers: auth() });
    const tokens = async (habitId: string) =>
        (await prisma.habit.findUniqueOrThrow({ where: { id: habitId }, select: { graceTokens: true } })).graceTokens;

    async function createHabit(name: string) {
        const res = await app.inject({ method: "POST", url: "/habits", headers: auth(), payload: { name } });
        expect(res.statusCode).toBe(201);
        return res.json().data.id as string;
    }

    beforeAll(async () => {
        app = buildApp();
        await app.ready();
        const user = await prisma.user.create({
            data: { name: "Usuário Grace", email: `grace-undo-${Date.now()}@example.com`, password: "hash-fake", timezone: "America/Sao_Paulo" },
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

    it("seg / qua (gasta token) / undo qua / qui: o token volta e o gap de 2 dias não é perdoado", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(at("2026-11-16"));
        const habitId = await createHabit("Seg-Qua-Qui");
        expect((await checkin(habitId)).statusCode).toBe(201);
        const tokensBeforeWednesday = await tokens(habitId);

        vi.setSystemTime(at("2026-11-18"));
        const wednesday = await checkin(habitId);
        expect(wednesday.json().data).toMatchObject({ currentStreak: 3, graceTokens: tokensBeforeWednesday - 1 });
        const fill = await prisma.graceFill.findFirstOrThrow({ where: { habitId } });
        expect(fill.date).toEqual(day("2026-11-17"));
        expect(fill.checkinId).toBe(wednesday.json().data.checkin.id);

        const undone = await undo(habitId);
        expect(undone.statusCode).toBe(200);
        expect(undone.json().data).toEqual({ currentStreak: 1, longestStreak: 1 });
        expect(await tokens(habitId)).toBe(tokensBeforeWednesday);
        expect(await prisma.graceFill.count({ where: { habitId } })).toBe(0);

        vi.setSystemTime(at("2026-11-19"));
        const thursday = await checkin(habitId);
        expect(thursday.statusCode).toBe(201);
        expect(thursday.json().data).toMatchObject({ currentStreak: 1, graceTokens: tokensBeforeWednesday });
        expect(await prisma.graceFill.count({ where: { habitId } })).toBe(0);
    });

    it("undo de check-in que não gastou token não mexe no saldo", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(at("2026-11-16"));
        const habitId = await createHabit("Sem gap");
        await checkin(habitId);
        vi.setSystemTime(at("2026-11-17"));
        await checkin(habitId);
        const before = await tokens(habitId);

        expect((await undo(habitId)).statusCode).toBe(200);
        expect(await tokens(habitId)).toBe(before);
    });

    it("grace fill antigo (sem checkinId) não é compensado no undo", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(at("2026-11-16"));
        const habitId = await createHabit("Fill legado");
        await checkin(habitId);
        vi.setSystemTime(at("2026-11-18"));
        await checkin(habitId);
        // simula uma linha gravada antes da coluna existir
        await prisma.graceFill.updateMany({ where: { habitId }, data: { checkinId: null } });
        const before = await tokens(habitId);

        expect((await undo(habitId)).statusCode).toBe(200);
        expect(await tokens(habitId)).toBe(before);
        expect(await prisma.graceFill.count({ where: { habitId } })).toBe(1);
    });

    it("o token devolvido respeita o teto de 3", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(at("2026-11-16"));
        const habitId = await createHabit("Teto");
        await checkin(habitId);
        vi.setSystemTime(at("2026-11-18"));
        await checkin(habitId);
        // saldo já no teto quando o undo devolve
        await prisma.habit.update({ where: { id: habitId }, data: { graceTokens: 3 } });

        expect((await undo(habitId)).statusCode).toBe(200);
        expect(await tokens(habitId)).toBe(3);
    });
});
