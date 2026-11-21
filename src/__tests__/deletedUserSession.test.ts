import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { prisma } from "../db";
import { REFRESH_COOKIE_NAME } from "../config/cookies";
import { bearer, createUser, deleteUsers } from "./helpers/factories";

// O que sobra da sessão depois que a conta é apagada.
// O refresh token some por cascade (decidido). O accessToken continua
// assinado e válido até expirar (1h), e o que cada rota faz com ele está
// em aberto: ADR-0008, status Proposto. Os it.todo abaixo viram testes
// quando o ADR for decidido.
describe("Sessão de um usuário apagado", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = buildApp();
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
        await prisma.$disconnect();
    });

    it("o refresh token deixa de funcionar quando a conta é apagada (401)", async () => {
        const user = await createUser({ prefix: "deleted-session" });
        try {
            const login = await app.inject({
                method: "POST",
                url: "/login",
                payload: { email: user.email, password: user.password },
            });
            expect(login.statusCode).toBe(200);
            const cookie = login.cookies.find((c) => c.name === REFRESH_COOKIE_NAME);
            expect(cookie).toBeDefined();

            const del = await app.inject({ method: "DELETE", url: `/users/${user.id}`, headers: bearer(user.token) });
            expect(del.statusCode).toBe(200);

            const refresh = await app.inject({
                method: "POST",
                url: "/refresh",
                headers: { cookie: `${REFRESH_COOKIE_NAME}=${cookie!.value}` },
            });
            expect(refresh.statusCode).toBe(401);
        } finally {
            await deleteUsers([user.id]);
        }
    });

    it("apagar a conta duas vezes com o mesmo token: a segunda responde 404", async () => {
        const user = await createUser({ prefix: "deleted-session-twice" });
        const first = await app.inject({ method: "DELETE", url: `/users/${user.id}`, headers: bearer(user.token) });
        expect(first.statusCode).toBe(200);

        const second = await app.inject({ method: "DELETE", url: `/users/${user.id}`, headers: bearer(user.token) });
        expect(second.statusCode).toBe(404);
    });

    // ADR-0008 (Proposto). Comportamento hoje, conferido em 2026-11-20:
    // POST /habits -> 500 (FK), GET /me/habits -> 200 { data: null }.
    it.todo("accessToken de conta apagada em POST /habits não responde 500");
    it.todo("accessToken de conta apagada em GET /me/habits não responde 200 com data null");
});
