import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { prisma } from "../db";
import { attemptTracker } from "../services/attemptTracker";

// Rate limit por IP (@fastify/rate-limit, src/Middleware/rateLimit.ts) e o
// limite de concorrência por conta no /login (src/controllers/indexController.ts).
// O contador de IP fica em memória por instância do app, então cada teste
// sobe um app novo para começar do zero.
const TOO_MANY = { statusCode: 429, error: "Too Many Requests", reqId: expect.any(String) };

describe("Rate limit", () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        app = buildApp();
        await app.ready();
    });

    afterEach(async () => {
        attemptTracker.reset();
        await app.close();
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it("POST /users: o 6º cadastro na mesma hora, do mesmo IP, -> 429", async () => {
        // payload inválido de propósito: o limite conta requisições, não
        // cadastros que deram certo, e assim nada é gravado.
        const attempt = () => app.inject({ method: "POST", url: "/users", payload: {} });

        for (let i = 0; i < 5; i++) {
            expect((await attempt()).statusCode).toBe(400);
        }

        const blocked = await attempt();
        expect(blocked.statusCode).toBe(429);
        expect(blocked.json()).toEqual(TOO_MANY);
        expect(blocked.headers["retry-after"]).toBeDefined();
    });

    it("POST /users: IPs diferentes têm contadores separados", async () => {
        const attempt = (ip: string) =>
            app.inject({ method: "POST", url: "/users", payload: {}, headers: { "x-forwarded-for": ip } });

        for (let i = 0; i < 5; i++) {
            await attempt("203.0.113.10");
        }
        expect((await attempt("203.0.113.10")).statusCode).toBe(429);
        expect((await attempt("203.0.113.20")).statusCode).toBe(400);
    });

    it("POST /login: a 21ª requisição no mesmo minuto, do mesmo IP, -> 429", async () => {
        // sem senha -> 400 na hora, sem passar pelo argon2
        const attempt = () => app.inject({ method: "POST", url: "/login", payload: { email: "x@example.com" } });

        for (let i = 0; i < 20; i++) {
            expect((await attempt()).statusCode).toBe(400);
        }

        const blocked = await attempt();
        expect(blocked.statusCode).toBe(429);
        expect(blocked.json()).toEqual(TOO_MANY);
    });

    it("POST /login: com a conta em atraso e o limite de concorrência cheio, responde 429 na hora com Retry-After", async () => {
        const email = "concorrencia@example.com";

        // 3 falhas = próxima tentativa já tem atraso
        for (let i = 0; i < 3; i++) attemptTracker.recordFailure(email);
        expect(attemptTracker.getDelay(email)).toBeGreaterThan(0);

        // ocupa as 3 vagas, como se 3 logins estivessem dormindo no atraso
        for (let i = 0; i < 3; i++) expect(attemptTracker.acquireSlot(email)).toBe(true);

        try {
            const started = Date.now();
            const res = await app.inject({ method: "POST", url: "/login", payload: { email, password: "qualquer" } });

            expect(res.statusCode).toBe(429);
            expect(res.json()).toEqual(TOO_MANY);
            expect(res.headers["retry-after"]).toBe("5");
            // não ficou segurando o socket pelo atraso
            expect(Date.now() - started).toBeLessThan(900);
        } finally {
            for (let i = 0; i < 3; i++) attemptTracker.releaseSlot(email);
        }
    });
});
