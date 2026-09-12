import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import { buildApp, prisma } from "../app";
import { attemptTracker } from "../services/attemptTracker";

describe("Gaps de cobertura fechados", () => {
    let app: FastifyInstance;
    const secretKey = process.env.SECRET_KEY as string;
    const password = "senha12345";

    let userId: string | undefined;
    let userToken: string;
    let otherUserId: string | undefined;
    let otherUserToken: string;
    let adminToken: string;

    afterEach(() => attemptTracker.reset());

    async function createUserAndLogin(email: string) {
        const createRes = await app.inject({
            method: "POST",
            url: "/users",
            payload: { name: "Usuário Teste", email, password, confirmPassword: password, timezone: "America/Sao_Paulo" },
        });
        const { id } = createRes.json().data;

        const loginRes = await app.inject({
            method: "POST",
            url: "/login",
            payload: { email, password },
        });
        const { accessToken } = loginRes.json().data;

        return { id, accessToken };
    }

    beforeAll(async () => {
        app = buildApp();
        await app.ready();

        const user = await createUserAndLogin(`gaps-${Date.now()}@example.com`);
        userId = user.id;
        userToken = user.accessToken;

        const otherUser = await createUserAndLogin(`gaps-other-${Date.now()}@example.com`);
        otherUserId = otherUser.id;
        otherUserToken = otherUser.accessToken;

        adminToken = jwt.sign({ id: "admin-gaps-test", role: "ADMIN" }, secretKey, { expiresIn: "1h" });
    });

    afterAll(async () => {
        const remainingUserIds = [userId, otherUserId].filter((id): id is string => Boolean(id));
        if (remainingUserIds.length > 0) {
            await prisma.habit.deleteMany({ where: { userId: { in: remainingUserIds } } }).catch(() => {});
            await prisma.user.deleteMany({ where: { id: { in: remainingUserIds } } }).catch(() => {});
        }
        await app.close();
        await prisma.$disconnect();
    });

    describe("Auth.user() - casos extremos", () => {
        it("SECRET_KEY ausente no ambiente -> 500 (erro de configuração do servidor)", async () => {
            const original = process.env.SECRET_KEY;
            delete process.env.SECRET_KEY;
            try {
                const res = await app.inject({
                    method: "GET",
                    url: "/me/habits",
                    headers: { authorization: `Bearer ${userToken}` },
                });
                expect(res.statusCode).toBe(500);
            } finally {
                process.env.SECRET_KEY = original;
            }
        });

        it("header 'Authorization: Bearer' sem token depois do espaço -> 401", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/me/habits",
                headers: { authorization: "Bearer" },
            });
            expect(res.statusCode).toBe(401);
        });
    });

    describe("Auth.admin() - falha de autenticação antes da checagem de papel", () => {
        it("rota admin-only sem token -> 401 (nunca chega a checar role)", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/habits",
            });
            expect(res.statusCode).toBe(401);
        });
    });

    describe("GET /users/:userId/habits (GetAllFromUser)", () => {
        it("admin pode ver os hábitos de qualquer usuário (200)", async () => {
            const res = await app.inject({
                method: "GET",
                url: `/users/${userId}/habits`,
                headers: { authorization: `Bearer ${adminToken}` },
            });
            expect(res.statusCode).toBe(200);
            expect(Array.isArray(res.json().data)).toBe(true);
        });

        it("o próprio usuário pode ver os próprios hábitos por essa rota (200)", async () => {
            const res = await app.inject({
                method: "GET",
                url: `/users/${userId}/habits`,
                headers: { authorization: `Bearer ${userToken}` },
            });
            expect(res.statusCode).toBe(200);
            expect(Array.isArray(res.json().data)).toBe(true);
        });

        it("usuário comum não pode ver hábitos de outro usuário que não seja ele mesmo (403)", async () => {
            const res = await app.inject({
                method: "GET",
                url: `/users/${userId}/habits`,
                headers: { authorization: `Bearer ${otherUserToken}` },
            });
            expect(res.statusCode).toBe(403);
        });

        it("userId inexistente -> 404 (bug 4: antes retornava 500)", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/users/id-que-nao-existe/habits",
                headers: { authorization: `Bearer ${adminToken}` },
            });
            expect(res.statusCode).toBe(404);
        });
    });

    describe("POST /habits (CreateHabit)", () => {
        it("cria um hábito vinculado ao usuário autenticado (201)", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/habits",
                headers: { authorization: `Bearer ${userToken}` },
                payload: { name: "Beber água" },
            });
            expect(res.statusCode).toBe(201);
            const habit = res.json().data;
            expect(habit.name).toBe("Beber água");
            expect(habit.userId).toBe(userId);
        });
    });

    describe("GET /users (GetAll, admin-only)", () => {
        it("admin lista os usuários (200)", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/users",
                headers: { authorization: `Bearer ${adminToken}` },
            });
            expect(res.statusCode).toBe(200);
            expect(Array.isArray(res.json().data)).toBe(true);
        });
    });

    describe("Nenhum dado fornecido para atualizar -> 400", () => {
        it("PATCH /users/:id com corpo vazio -> 400", async () => {
            const res = await app.inject({
                method: "PATCH",
                url: `/users/${userId}`,
                headers: { authorization: `Bearer ${userToken}` },
                payload: {},
            });
            expect(res.statusCode).toBe(400);
        });

        it("PATCH /habits/:id com corpo vazio -> 400", async () => {
            const habitRes = await app.inject({
                method: "POST",
                url: "/habits",
                headers: { authorization: `Bearer ${userToken}` },
                payload: { name: "Hábito pro teste de corpo vazio" },
            });
            const habitId = habitRes.json().data.id;

            const res = await app.inject({
                method: "PATCH",
                url: `/habits/${habitId}`,
                headers: { authorization: `Bearer ${userToken}` },
                payload: {},
            });
            expect(res.statusCode).toBe(400);
        });
    });
});
