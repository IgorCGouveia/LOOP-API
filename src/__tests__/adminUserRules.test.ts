import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { prisma } from "../db";
import { bearer, createAdmin, createUser, deleteUsers, type TestUser } from "./helpers/factories";

// Regras de admin sobre usuários (src/controllers/UserController.ts).
// Admin aqui é um usuário de verdade no banco, não um JWT com id inventado.
describe("Admin e as rotas de usuário", () => {
    let app: FastifyInstance;
    let admin: TestUser;
    let otherAdmin: TestUser;
    let user: TestUser;

    beforeAll(async () => {
        app = buildApp();
        await app.ready();
        admin = await createAdmin({ prefix: "admin-rules" });
        otherAdmin = await createAdmin({ prefix: "admin-rules-other" });
        user = await createUser({ prefix: "admin-rules-user", name: "Nome Original" });
    });

    afterAll(async () => {
        await deleteUsers([admin?.id, otherAdmin?.id, user?.id]);
        await app.close();
        await prisma.$disconnect();
    });

    it("GET /users lista sem nunca devolver password ou timezone", async () => {
        const res = await app.inject({ method: "GET", url: "/users", headers: bearer(admin.token) });
        expect(res.statusCode).toBe(200);

        const listed = res.json().data as Array<Record<string, unknown>>;
        const me = listed.find((u) => u.id === user.id);
        expect(me).toEqual({ id: user.id, email: user.email, name: "Nome Original", role: "USER" });
        for (const row of listed) {
            expect(row).not.toHaveProperty("password");
        }
    });

    it("admin não edita o perfil de outra pessoa (403) e nada muda", async () => {
        const res = await app.inject({
            method: "PATCH",
            url: `/users/${user.id}`,
            headers: bearer(admin.token),
            payload: { name: "Nome do Admin" },
        });
        expect(res.statusCode).toBe(403);

        const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
        expect(stored.name).toBe("Nome Original");
    });

    it("admin não apaga outro admin (403) e o outro admin continua lá", async () => {
        const res = await app.inject({
            method: "DELETE",
            url: `/users/${otherAdmin.id}`,
            headers: bearer(admin.token),
        });
        expect(res.statusCode).toBe(403);
        expect(await prisma.user.count({ where: { id: otherAdmin.id } })).toBe(1);
    });

    it("usuário comum não lista usuários (403)", async () => {
        const res = await app.inject({ method: "GET", url: "/users", headers: bearer(user.token) });
        expect(res.statusCode).toBe(403);
    });

    it("admin apaga a própria conta (200), mesmo sendo admin", async () => {
        const res = await app.inject({
            method: "DELETE",
            url: `/users/${otherAdmin.id}`,
            headers: bearer(otherAdmin.token),
        });
        expect(res.statusCode).toBe(200);
        expect(await prisma.user.count({ where: { id: otherAdmin.id } })).toBe(0);
    });

    it("apagar um usuário apaga os hábitos e os refresh tokens dele (cascade)", async () => {
        const victim = await createUser({ prefix: "admin-rules-cascade" });
        const habit = await app.inject({
            method: "POST",
            url: "/habits",
            headers: bearer(victim.token),
            payload: { name: "Hábito que some" },
        });
        expect(habit.statusCode).toBe(201);
        const login = await app.inject({
            method: "POST",
            url: "/login",
            payload: { email: victim.email, password: victim.password },
        });
        expect(login.statusCode).toBe(200);

        const res = await app.inject({ method: "DELETE", url: `/users/${victim.id}`, headers: bearer(admin.token) });
        expect(res.statusCode).toBe(200);

        expect(await prisma.habit.count({ where: { userId: victim.id } })).toBe(0);
        expect(await prisma.refreshToken.count({ where: { userId: victim.id } })).toBe(0);
    });
});
