import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { prisma } from "../db";
import { bearer, createUser, deleteUsers, type TestUser } from "./helpers/factories";

// Validação e conflitos nas rotas de usuário. A allowlist do PATCH
// (timezone, role) está em timezoneFrozen.test.ts.
describe("Rotas de usuário: validação e conflitos", () => {
    let app: FastifyInstance;
    let user: TestUser;
    let other: TestUser;

    const patchMe = (payload: object) =>
        app.inject({ method: "PATCH", url: `/users/${user.id}`, headers: bearer(user.token), payload });

    beforeAll(async () => {
        app = buildApp();
        await app.ready();
        user = await createUser({ prefix: "user-val" });
        other = await createUser({ prefix: "user-val-other" });
    });

    afterAll(async () => {
        await deleteUsers([user?.id, other?.id]);
        await app.close();
        await prisma.$disconnect();
    });

    describe("PATCH /users/:id", () => {
        it("trocar para o email de outra pessoa -> 409 e o email não muda", async () => {
            const res = await patchMe({ email: other.email });
            expect(res.statusCode).toBe(409);
            expect(res.json()).toEqual({ error: "Email já cadastrado." });

            const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
            expect(stored.email).toBe(user.email);
        });

        it("password sem confirmPassword -> 400", async () => {
            const res = await patchMe({ password: "novaSenha123" });
            expect(res.statusCode).toBe(400);
        });

        it("password e confirmPassword diferentes -> 400 e a senha antiga continua valendo", async () => {
            const res = await patchMe({ password: "novaSenha123", confirmPassword: "outraSenha123" });
            expect(res.statusCode).toBe(400);
            expect(res.json().details).toContainEqual({ campo: "", message: "As senhas não coincidem" });

            const login = await app.inject({
                method: "POST",
                url: "/login",
                payload: { email: user.email, password: user.password },
            });
            expect(login.statusCode).toBe(200);
        });

        it.each([
            ["nome curto demais", { name: "ab" }],
            ["nome longo demais", { name: "x".repeat(51) }],
            ["email inválido", { email: "nao-e-email" }],
            ["senha curta demais", { password: "1234567", confirmPassword: "1234567" }],
            ["senha longa demais", { password: "x".repeat(129), confirmPassword: "x".repeat(129) }],
        ])("%s -> 400", async (_caso, payload) => {
            const res = await patchMe(payload);
            expect(res.statusCode).toBe(400);
            expect(res.json().error).toBe("Dados inválidos.");
        });

        it("trocar o email para um livre funciona e o login passa a usar o novo", async () => {
            const newEmail = `novo-${user.email}`;
            const res = await patchMe({ email: newEmail });
            expect(res.statusCode).toBe(200);
            expect(res.json().data.email).toBe(newEmail);
            user.email = newEmail;

            const login = await app.inject({
                method: "POST",
                url: "/login",
                payload: { email: newEmail, password: user.password },
            });
            expect(login.statusCode).toBe(200);
        });
    });

    describe("POST /users", () => {
        const valid = () => ({
            name: "Novo Usuário",
            email: `post-users-${Date.now()}@example.com`,
            password: "senha12345",
            confirmPassword: "senha12345",
            timezone: "America/Sao_Paulo",
        });

        it.each([
            ["timezone que não é IANA", { timezone: "GMT-3" }],
            ["timezone ausente", { timezone: undefined }],
            ["senhas diferentes", { confirmPassword: "outraSenha123" }],
        ])("%s -> 400 e nada é gravado", async (_caso, override) => {
            const payload = { ...valid(), ...override };
            const res = await app.inject({ method: "POST", url: "/users", payload });
            expect(res.statusCode).toBe(400);
            expect(await prisma.user.count({ where: { email: payload.email } })).toBe(0);
        });
    });
});
