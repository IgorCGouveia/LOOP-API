import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { prisma } from "../db";

// Erros de cliente que o Fastify gera antes do handler (parser do corpo).
// Passam pelo errorHandler customizado, que antes devolvia 500 para todos.
// O 429 do rate limit está em rateLimit.test.ts.
describe("errorHandler: erros 4xx do Fastify mantêm o status", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = buildApp();
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
        await prisma.$disconnect();
    });

    it("JSON malformado -> 400", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/users",
            headers: { "content-type": "application/json" },
            payload: "{nao-e-json",
        });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: "Corpo da requisição inválido." });
    });

    it("Content-Type não suportado -> 415", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/users",
            headers: { "content-type": "text/xml" },
            payload: "<user/>",
        });
        expect(res.statusCode).toBe(415);
        expect(res.json()).toEqual({ error: "Content-Type não suportado." });
    });

    it("corpo acima do limite do Fastify (1 MiB) -> 413", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/users",
            headers: { "content-type": "application/json" },
            payload: JSON.stringify({ name: "x".repeat(1_100_000) }),
        });
        expect(res.statusCode).toBe(413);
        expect(res.json()).toEqual({ error: "Corpo da requisição grande demais." });
    });

    it("a resposta não vaza a mensagem interna do parser", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/users",
            headers: { "content-type": "application/json" },
            payload: "{nao-e-json",
        });
        expect(res.body).not.toMatch(/FST_|Unexpected token|SyntaxError/);
    });
});
