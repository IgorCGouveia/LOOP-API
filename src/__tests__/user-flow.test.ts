import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, prisma } from "../app";
import { attemptTracker } from "../services/attemptTracker";

describe("Fluxo completo: criar usuário -> login -> usar token", () => {
    let app: FastifyInstance;
    let userId: string | undefined;

    const email = `teste-${Date.now()}@example.com`;
    const password = "senha12345";

    afterEach(() => attemptTracker.reset());

    beforeAll(async () => {
        app = buildApp();
        await app.ready();
    });

    afterAll(async () => {
        if (userId) {
            await prisma.user.delete({ where: { id: userId } }).catch(() => {});
        }
        await app.close();
        await prisma.$disconnect();
    });

    it("cria o usuário, loga e acessa uma rota protegida com o token recebido", async () => {
        const createRes = await app.inject({
            method: "POST",
            url: "/users",
            payload: {
                name: "Usuário de Teste",
                email,
                password,
                confirmPassword: password,
                timezone: "America/Sao_Paulo",
            },
        });

        expect(createRes.statusCode).toBe(201);
        const createdUser = createRes.json().data;
        expect(createdUser.email).toBe(email);
        expect(createdUser).not.toHaveProperty("password");
        userId = createdUser.id;

        const loginRes = await app.inject({
            method: "POST",
            url: "/login",
            payload: { email, password },
        });

        expect(loginRes.statusCode).toBe(200);
        const { accessToken } = loginRes.json().data;
        expect(typeof accessToken).toBe("string");

        const protectedRes = await app.inject({
            method: "GET",
            url: "/me/habits",
            headers: { authorization: `Bearer ${accessToken}` },
        });

        expect(protectedRes.statusCode).toBe(200);
        expect(protectedRes.json().data).toEqual([]);
    });
});
