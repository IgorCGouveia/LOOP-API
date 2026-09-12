import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import { buildApp, prisma } from "../app";
import { attemptTracker } from "../services/attemptTracker";

describe("Ownership (dono vs. não-dono vs. admin)", () => {
    let app: FastifyInstance;
    const secretKey = process.env.SECRET_KEY as string;
    const password = "senha12345";

    let ownerId: string | undefined;
    let ownerEmail: string;
    let ownerToken: string;
    let otherId: string | undefined;
    let otherToken: string;
    let adminToken: string;

    afterEach(() => attemptTracker.reset());

    let habitToUpdateId: string;
    let habitToDeleteId: string;

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

        return { id, email, accessToken };
    }

    beforeAll(async () => {
        app = buildApp();
        await app.ready();

        const owner = await createUserAndLogin(`owner-${Date.now()}@example.com`);
        ownerId = owner.id;
        ownerEmail = owner.email;
        ownerToken = owner.accessToken;

        const other = await createUserAndLogin(`other-${Date.now()}@example.com`);
        otherId = other.id;
        otherToken = other.accessToken;

        // Sem endpoint pra promover usuário a admin, então forjamos o JWT
        // direto (o middleware Auth.user só verifica a assinatura, não
        // confere se esse "admin" existe de verdade no banco).
        adminToken = jwt.sign({ id: "admin-ownership-test", role: "ADMIN" }, secretKey, { expiresIn: "1h" });

        const habit1 = await app.inject({
            method: "POST",
            url: "/habits",
            headers: { authorization: `Bearer ${ownerToken}` },
            payload: { name: "Hábito pra atualizar" },
        });
        habitToUpdateId = habit1.json().data.id;

        const habit2 = await app.inject({
            method: "POST",
            url: "/habits",
            headers: { authorization: `Bearer ${ownerToken}` },
            payload: { name: "Hábito pra deletar" },
        });
        habitToDeleteId = habit2.json().data.id;
    });

    afterAll(async () => {
        const remainingUserIds = [ownerId, otherId].filter((id): id is string => Boolean(id));
        if (remainingUserIds.length > 0) {
            await prisma.habit.deleteMany({ where: { userId: { in: remainingUserIds } } }).catch(() => {});
            await prisma.user.deleteMany({ where: { id: { in: remainingUserIds } } }).catch(() => {});
        }
        await app.close();
        await prisma.$disconnect();
    });

    describe("Hábitos", () => {
        it("não-dono não pode atualizar hábito de outro usuário (403)", async () => {
            const res = await app.inject({
                method: "PATCH",
                url: `/habits/${habitToUpdateId}`,
                headers: { authorization: `Bearer ${otherToken}` },
                payload: { name: "Nome forjado" },
            });
            expect(res.statusCode).toBe(403);
        });

        it("dono pode atualizar seu próprio hábito (200)", async () => {
            const res = await app.inject({
                method: "PATCH",
                url: `/habits/${habitToUpdateId}`,
                headers: { authorization: `Bearer ${ownerToken}` },
                payload: { name: "Hábito atualizado" },
            });
            expect(res.statusCode).toBe(200);
            expect(res.json().data.name).toBe("Hábito atualizado");
        });

        it("atualizar hábito inexistente retorna 404", async () => {
            const res = await app.inject({
                method: "PATCH",
                url: "/habits/id-que-nao-existe",
                headers: { authorization: `Bearer ${ownerToken}` },
                payload: { name: "Não importa" },
            });
            expect(res.statusCode).toBe(404);
        });

        it("não-dono não pode deletar hábito de outro usuário (403)", async () => {
            const res = await app.inject({
                method: "DELETE",
                url: `/habits/${habitToDeleteId}`,
                headers: { authorization: `Bearer ${otherToken}` },
            });
            expect(res.statusCode).toBe(403);
        });

        it("deletar hábito inexistente retorna 404", async () => {
            const res = await app.inject({
                method: "DELETE",
                url: "/habits/id-que-nao-existe",
                headers: { authorization: `Bearer ${ownerToken}` },
            });
            expect(res.statusCode).toBe(404);
        });

        it("dono pode deletar seu próprio hábito (200)", async () => {
            const res = await app.inject({
                method: "DELETE",
                url: `/habits/${habitToDeleteId}`,
                headers: { authorization: `Bearer ${ownerToken}` },
            });
            expect(res.statusCode).toBe(200);
        });
    });

    describe("Usuários", () => {
        it("não-dono não pode atualizar perfil de outro usuário (403)", async () => {
            const res = await app.inject({
                method: "PATCH",
                url: `/users/${otherId}`,
                headers: { authorization: `Bearer ${ownerToken}` },
                payload: { name: "Nome forjado" },
            });
            expect(res.statusCode).toBe(403);
        });

        it("usuário pode atualizar o próprio perfil (200)", async () => {
            const res = await app.inject({
                method: "PATCH",
                url: `/users/${ownerId}`,
                headers: { authorization: `Bearer ${ownerToken}` },
                payload: { name: "Nome Atualizado" },
            });
            expect(res.statusCode).toBe(200);
            expect(res.json().data.name).toBe("Nome Atualizado");
        });

        it("usuário pode atualizar a própria senha, e a senha nova passa a funcionar no login (200)", async () => {
            const novaSenha = "novaSenha456";
            const res = await app.inject({
                method: "PATCH",
                url: `/users/${ownerId}`,
                headers: { authorization: `Bearer ${ownerToken}` },
                payload: { password: novaSenha, confirmPassword: novaSenha },
            });
            expect(res.statusCode).toBe(200);

            const loginComSenhaAntiga = await app.inject({
                method: "POST",
                url: "/login",
                payload: { email: ownerEmail, password },
            });
            expect(loginComSenhaAntiga.statusCode).toBe(401);

            const loginComSenhaNova = await app.inject({
                method: "POST",
                url: "/login",
                payload: { email: ownerEmail, password: novaSenha },
            });
            expect(loginComSenhaNova.statusCode).toBe(200);

            // Reautentica com o novo token, já que o antigo continua válido
            // (JWT stateless não é invalidado ao trocar a senha), mas os
            // testes seguintes assumem que ownerToken condiz com a senha atual.
            ownerToken = loginComSenhaNova.json().data.accessToken;
        });

        it("atualizar usuário inexistente retorna 404", async () => {
            const res = await app.inject({
                method: "PATCH",
                url: "/users/id-que-nao-existe",
                headers: { authorization: `Bearer ${ownerToken}` },
                payload: { name: "Não importa" },
            });
            expect(res.statusCode).toBe(404);
        });

        it("usuário comum não pode deletar perfil de outro usuário (403)", async () => {
            const res = await app.inject({
                method: "DELETE",
                url: `/users/${otherId}`,
                headers: { authorization: `Bearer ${ownerToken}` },
            });
            expect(res.statusCode).toBe(403);
        });

        it("deletar usuário inexistente retorna 404", async () => {
            const res = await app.inject({
                method: "DELETE",
                url: "/users/id-que-nao-existe",
                headers: { authorization: `Bearer ${ownerToken}` },
            });
            expect(res.statusCode).toBe(404);
        });

        it("admin pode deletar um usuário não-admin (200)", async () => {
            const res = await app.inject({
                method: "DELETE",
                url: `/users/${otherId}`,
                headers: { authorization: `Bearer ${adminToken}` },
            });
            expect(res.statusCode).toBe(200);
            otherId = undefined;
        });

        it("usuário pode deletar o próprio perfil (200)", async () => {
            const res = await app.inject({
                method: "DELETE",
                url: `/users/${ownerId}`,
                headers: { authorization: `Bearer ${ownerToken}` },
            });
            expect(res.statusCode).toBe(200);
            ownerId = undefined;
        });
    });
});
