import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, prisma } from "../app";
import { attemptTracker } from "../services/attemptTracker";

// issue #15 / doc-2/adr/0002: timezone é congelado no cadastro. Trocar
// depois misturaria dias gravados em calendários diferentes.
describe("timezone congelado depois do cadastro", () => {
    let app: FastifyInstance;
    const password = "senha12345";
    const email = `tz-frozen-${Date.now()}@example.com`;
    let userId: string | undefined;

    // segunda 2026-11-16 12:00 em Los Angeles / terça 2026-11-17 12:00 em LA.
    // Na terça, 20:00Z já é quarta 05:00 em Tóquio — é o instante em que
    // uma troca LA -> Tóquio criaria um dia pulado que não existiu.
    const MONDAY_LA = new Date("2026-11-16T20:00:00.000Z");
    const TUESDAY_LA = new Date("2026-11-17T20:00:00.000Z");

    async function login() {
        const res = await app.inject({ method: "POST", url: "/login", payload: { email, password } });
        return res.json().data.accessToken as string;
    }

    beforeAll(async () => {
        app = buildApp();
        await app.ready();
    });

    afterEach(() => {
        vi.useRealTimers();
        attemptTracker.reset();
    });

    afterAll(async () => {
        if (userId) {
            await prisma.habit.deleteMany({ where: { userId } }).catch(() => {});
            await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
        }
        await app.close();
        await prisma.$disconnect();
    });

    it("PATCH com timezone -> 400, timezone não muda e o check-in seguinte não gasta grace token", async () => {
        // só Date é falso — timers reais continuam rodando pro Prisma/Fastify
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(MONDAY_LA);

        const createRes = await app.inject({
            method: "POST",
            url: "/users",
            payload: { name: "Usuário TZ", email, password, confirmPassword: password, timezone: "America/Los_Angeles" },
        });
        expect(createRes.statusCode).toBe(201);
        userId = createRes.json().data.id;

        let token = await login();
        const auth = () => ({ authorization: `Bearer ${token}` });

        const habitRes = await app.inject({
            method: "POST",
            url: "/habits",
            headers: auth(),
            payload: { name: "Ler", schedule: { type: "DAILY", targetPerDay: 1 } },
        });
        expect(habitRes.statusCode).toBe(201);
        const habitId = habitRes.json().data.id;

        const mondayCheckin = await app.inject({ method: "POST", url: `/habits/${habitId}/checkin`, headers: auth() });
        expect(mondayCheckin.statusCode).toBe(201);
        expect(mondayCheckin.json().data.checkin.date).toBe("2026-11-16T00:00:00.000Z");

        const patchRes = await app.inject({
            method: "PATCH",
            url: `/users/${userId}`,
            headers: auth(),
            payload: { timezone: "Asia/Tokyo" },
        });
        expect(patchRes.statusCode).toBe(400);
        expect(patchRes.json()).toEqual({
            error: "Dados inválidos.",
            details: [{ campo: "", message: "Campo não pode ser alterado: timezone." }],
        });

        const stored = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
        expect(stored?.timezone).toBe("America/Los_Angeles");

        // o token de segunda já expirou na terça — loga de novo
        vi.setSystemTime(TUESDAY_LA);
        token = await login();

        const tuesdayCheckin = await app.inject({ method: "POST", url: `/habits/${habitId}/checkin`, headers: auth() });
        expect(tuesdayCheckin.statusCode).toBe(201);
        const data = tuesdayCheckin.json().data;
        expect(data.checkin.date).toBe("2026-11-17T00:00:00.000Z");
        expect(data.currentStreak).toBe(2);
        expect(data.graceTokens).toBe(1);

        const graceFills = await prisma.graceFill.count({ where: { habitId } });
        expect(graceFills).toBe(0);
    });

    it("PATCH com campo permitido junto de um não permitido -> 400 e nada é gravado", async () => {
        const token = await login();

        const res = await app.inject({
            method: "PATCH",
            url: `/users/${userId}`,
            headers: { authorization: `Bearer ${token}` },
            payload: { name: "Nome Novo", role: "ADMIN" },
        });
        expect(res.statusCode).toBe(400);

        const stored = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, role: true } });
        expect(stored).toEqual({ name: "Usuário TZ", role: "USER" });
    });

    it("PATCH só com campos permitidos continua funcionando", async () => {
        const token = await login();

        const res = await app.inject({
            method: "PATCH",
            url: `/users/${userId}`,
            headers: { authorization: `Bearer ${token}` },
            payload: { name: "Nome Novo" },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().data.name).toBe("Nome Novo");
    });
});
