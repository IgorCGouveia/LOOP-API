import { describe, it, expect, afterEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { prisma } from "../db";

// CORS (src/Middleware/cors.ts). Com credentials: true e o cookie de
// refresh em sameSite "none", a lista de origens é a defesa contra CSRF:
// origem fora da lista não pode receber Access-Control-Allow-Origin.
// A lista é lida no buildApp(), então cada teste sobe o próprio app.
describe("CORS", () => {
    let app: FastifyInstance | undefined;
    const originalEnv = process.env.CORS_ORIGIN;

    async function start(corsOrigin: string | undefined) {
        if (corsOrigin === undefined) delete process.env.CORS_ORIGIN;
        else process.env.CORS_ORIGIN = corsOrigin;
        app = buildApp();
        await app.ready();
        return app;
    }

    const preflight = (server: FastifyInstance, origin: string, method: string) =>
        server.inject({
            method: "OPTIONS",
            url: "/habits/qualquer",
            headers: { origin, "access-control-request-method": method },
        });

    afterEach(async () => {
        await app?.close();
        app = undefined;
        if (originalEnv === undefined) delete process.env.CORS_ORIGIN;
        else process.env.CORS_ORIGIN = originalEnv;
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it("origem da lista recebe Allow-Origin exato (nunca *) e Allow-Credentials", async () => {
        const server = await start("https://loop-web.example.com");
        const res = await server.inject({ method: "POST", url: "/logout", headers: { origin: "https://loop-web.example.com" } });

        expect(res.headers["access-control-allow-origin"]).toBe("https://loop-web.example.com");
        expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });

    it("origem fora da lista não recebe Allow-Origin", async () => {
        const server = await start("https://loop-web.example.com");
        const res = await server.inject({ method: "POST", url: "/logout", headers: { origin: "https://atacante.example.com" } });

        expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("origem parecida (subdomínio, outro esquema) não passa", async () => {
        const server = await start("https://loop-web.example.com");
        for (const origin of ["https://evil.loop-web.example.com", "http://loop-web.example.com", "https://loop-web.example.com.evil.com"]) {
            const res = await server.inject({ method: "POST", url: "/logout", headers: { origin } });
            expect(res.headers["access-control-allow-origin"], origin).toBeUndefined();
        }
    });

    it("CORS_ORIGIN aceita lista separada por vírgula, com espaços", async () => {
        const server = await start(" https://a.example.com , https://b.example.com ,");
        for (const origin of ["https://a.example.com", "https://b.example.com"]) {
            const res = await server.inject({ method: "POST", url: "/logout", headers: { origin } });
            expect(res.headers["access-control-allow-origin"]).toBe(origin);
        }
    });

    it("sem CORS_ORIGIN, só as origens de dev em localhost passam", async () => {
        const server = await start(undefined);

        const dev = await server.inject({ method: "POST", url: "/logout", headers: { origin: "http://localhost:5173" } });
        expect(dev.headers["access-control-allow-origin"]).toBe("http://localhost:5173");

        const other = await server.inject({ method: "POST", url: "/logout", headers: { origin: "https://qualquer.example.com" } });
        expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it.each(["PATCH", "DELETE"])("preflight libera %s (fora do default do @fastify/cors)", async (method) => {
        const server = await start("https://loop-web.example.com");
        const res = await preflight(server, "https://loop-web.example.com", method);

        expect(res.statusCode).toBe(204);
        expect(String(res.headers["access-control-allow-methods"])).toContain(method);
    });
});
