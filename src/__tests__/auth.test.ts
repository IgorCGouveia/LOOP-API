import { describe, it, expect, beforeAll, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import { buildApp, prisma } from "../app";

describe("Auth middleware", () => {
    let app: FastifyInstance;
    const secretKey = process.env.SECRET_KEY as string;

    beforeAll(async () => {
        app = buildApp();
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
        await prisma.$disconnect();
    });

    function tokenFor(role: "USER" | "ADMIN") {
        return jwt.sign({ id: "test-user-id", role }, secretKey, { expiresIn: "1h" });
    }

    it("sem token -> 401", async () => {
        const res = await app.inject({ method: "GET", url: "/me/habits" });
        expect(res.statusCode).toBe(401);
    });

    it("token inválido -> 401", async () => {
        const res = await app.inject({
            method: "GET",
            url: "/me/habits",
            headers: { authorization: "Bearer token-invalido" },
        });
        expect(res.statusCode).toBe(401);
    });

    it("rota admin-only com usuário comum -> 403", async () => {
        const res = await app.inject({
            method: "GET",
            url: "/habits",
            headers: { authorization: `Bearer ${tokenFor("USER")}` },
        });
        expect(res.statusCode).toBe(403);
    });

    it("rota admin-only com admin -> 200", async () => {
        const res = await app.inject({
            method: "GET",
            url: "/habits",
            headers: { authorization: `Bearer ${tokenFor("ADMIN")}` },
        });
        expect(res.statusCode).toBe(200);
    });
});
