import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { prisma } from "../db";
import { bearer, createUser, deleteUsers, signRaw, type TestUser } from "./helpers/factories";

// Casos de borda do Auth.user (src/Middleware/Auth.ts). Os casos básicos
// (sem header, token malformado, role errada) ficam em auth.test.ts e
// gaps.test.ts.
describe("Auth.user: casos de borda do token", () => {
    let app: FastifyInstance;
    let user: TestUser;

    const getMyHabits = (headers: Record<string, string>) =>
        app.inject({ method: "GET", url: "/me/habits", headers });

    beforeAll(async () => {
        app = buildApp();
        await app.ready();
        user = await createUser({ prefix: "auth-edge" });
    });

    afterAll(async () => {
        await deleteUsers([user?.id]);
        await app.close();
        await prisma.$disconnect();
    });

    it("token válido do próprio usuário passa (controle)", async () => {
        const res = await getMyHabits(bearer(user.token));
        expect(res.statusCode).toBe(200);
    });

    it("esquema em minúsculas (`bearer`) também passa: o esquema não diferencia caixa", async () => {
        const res = await getMyHabits({ authorization: `bearer ${user.token}` });
        expect(res.statusCode).toBe(200);
    });

    describe("token recusado com 401", () => {
        const payload = () => ({ id: user.id, role: "USER" });

        it.each([
            ["expirado", () => signRaw(payload(), { expiresIn: -10 })],
            ["assinado com outra chave", () => signRaw(payload(), {}, "outra-chave-de-teste-com-32-caracteres!!")],
            ["assinado com HS512 (fora da lista de algoritmos aceitos)", () => signRaw(payload(), { algorithm: "HS512" })],
            ["sem `id` no payload", () => signRaw({ role: "USER" })],
            ["com `id` vazio", () => signRaw({ id: "", role: "USER" })],
            ["sem `role` no payload", () => signRaw({ id: user.id })],
            ["com `role` fora do enum", () => signRaw({ id: user.id, role: "SUPERUSER" })],
            ["com payload string em vez de objeto", () => signRaw("so-uma-string")],
        ])("token %s", async (_caso, makeToken) => {
            const res = await getMyHabits(bearer(makeToken()));
            expect(res.statusCode).toBe(401);
            expect(res.json()).toEqual({ error: "Token inválido ou expirado." });
        });

        it("token com `alg: none` (sem assinatura)", async () => {
            const encode = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
            const unsigned = `${encode({ alg: "none", typ: "JWT" })}.${encode({ id: user.id, role: "ADMIN" })}.`;

            const res = await app.inject({ method: "GET", url: "/habits", headers: bearer(unsigned) });
            expect(res.statusCode).toBe(401);
        });

        it("token com a assinatura adulterada (payload trocado para ADMIN)", async () => {
            const [header, , signature] = user.token.split(".");
            const forged = Buffer.from(JSON.stringify({ id: user.id, role: "ADMIN" })).toString("base64url");

            const res = await app.inject({ method: "GET", url: "/habits", headers: bearer(`${header}.${forged}.${signature}`) });
            expect(res.statusCode).toBe(401);
        });
    });

    describe("header Authorization em formato errado -> 401", () => {
        it.each([
            ["esquema Basic com um JWT válido", () => `Basic ${user.token}`],
            ["token sem esquema", () => user.token],
            ["partes demais", () => `Bearer ${user.token} extra`],
        ])("%s", async (_caso, makeHeader) => {
            const res = await getMyHabits({ authorization: makeHeader() });
            expect(res.statusCode).toBe(401);
            expect(res.json()).toEqual({ error: "Header Authorization inválido. Use: Bearer <token>." });
        });

        it("espaços extras entre esquema e token são tolerados", async () => {
            const res = await getMyHabits({ authorization: `Bearer   ${user.token}` });
            expect(res.statusCode).toBe(200);
        });
    });

    it("rota de admin com token de admin malformado para no 401, nunca chega no 403", async () => {
        const res = await app.inject({
            method: "GET",
            url: "/users",
            headers: bearer(signRaw({ role: "ADMIN" })),
        });
        expect(res.statusCode).toBe(401);
    });
});
