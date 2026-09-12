import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, prisma } from "../app";
import { attemptTracker } from "../services/attemptTracker";

describe("Correções de bugs (docs/problems/PROBLEMAS.md)", () => {
    let app: FastifyInstance;
    const password = "senha12345";

    let userId: string | undefined;
    const email = `bugfix-${Date.now()}@example.com`;

    // evita acumular falhas de login entre os its deste arquivo
    afterEach(() => attemptTracker.reset());

    beforeAll(async () => {
        app = buildApp();
        await app.ready();

        const createRes = await app.inject({
            method: "POST",
            url: "/users",
            payload: { name: "Usuário Bugfix", email, password, confirmPassword: password, timezone: "America/Sao_Paulo" },
        });
        userId = createRes.json().data.id;
    });

    afterAll(async () => {
        if (userId) {
            await prisma.user.delete({ where: { id: userId } }).catch(() => {});
        }
        await app.close();
        await prisma.$disconnect();
    });

    describe("Bug 1 - erro de validação Zod não capturado", () => {
        it("POST /users com payload inválido -> 400, sem vazar detalhes internos do Zod", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/users",
                payload: { name: "a", email: "invalido", password: "123", confirmPassword: "456" },
            });

            expect(res.statusCode).toBe(400);

            const body = res.json();
            expect(typeof body.error).toBe("string");
            expect(Array.isArray(body.details)).toBe(true);
            expect(body.details.length).toBeGreaterThan(0);

            for (const issue of body.details) {
                expect(Object.keys(issue).sort()).toEqual(["campo", "message"]);
            }

            const raw = res.body;
            expect(raw).not.toContain("pattern");
            expect(raw).not.toContain("origin");
            expect(raw).not.toContain("ZodError");
        });

        it("POST /habits com payload inválido -> 400 (mesmo error handler, outra rota)", async () => {
            const loginRes = await app.inject({
                method: "POST",
                url: "/login",
                payload: { email, password },
            });
            const { accessToken } = loginRes.json().data;

            const res = await app.inject({
                method: "POST",
                url: "/habits",
                headers: { authorization: `Bearer ${accessToken}` },
                payload: { name: "a" },
            });

            expect(res.statusCode).toBe(400);
            const body = res.json();
            expect(Array.isArray(body.details)).toBe(true);
            expect(body.details[0]).toHaveProperty("campo");
            expect(body.details[0]).toHaveProperty("message");
        });
    });

    describe("Bug 2 - erro de login não capturado", () => {
        it("email ou senha ausentes no corpo -> 400", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/login",
                payload: { email },
            });
            expect(res.statusCode).toBe(400);
        });

        it("email inexistente -> 401 genérico", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/login",
                payload: { email: "nao-existe@example.com", password: "qualquercoisa" },
            });
            expect(res.statusCode).toBe(401);
        });

        it("senha errada -> 401 genérico", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/login",
                payload: { email, password: "senhaErrada123" },
            });
            expect(res.statusCode).toBe(401);
        });

        it("login com credenciais válidas continua funcionando (200)", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/login",
                payload: { email, password },
            });
            expect(res.statusCode).toBe(200);
            expect(typeof res.json().data.accessToken).toBe("string");
        });

        it("SECRET_KEY ausente durante login -> 500 (erro de configuração, não de credencial)", async () => {
            const original = process.env.SECRET_KEY;
            delete process.env.SECRET_KEY;
            try {
                const res = await app.inject({
                    method: "POST",
                    url: "/login",
                    payload: { email, password },
                });
                expect(res.statusCode).toBe(500);
            } finally {
                process.env.SECRET_KEY = original;
            }
        });

        it("500 genérico não vaza error.message; devolve só statusCode/error/reqId", async () => {
            const original = process.env.SECRET_KEY;
            delete process.env.SECRET_KEY;
            try {
                const res = await app.inject({
                    method: "POST",
                    url: "/login",
                    payload: { email, password },
                });

                expect(res.statusCode).toBe(500);
                expect(res.body).not.toContain("Nao existe Secret Key");

                const body = res.json();
                expect(body).toEqual({
                    statusCode: 500,
                    error: "Internal Server Error",
                    reqId: expect.any(String),
                });
                expect(body).not.toHaveProperty("message");
            } finally {
                process.env.SECRET_KEY = original;
            }
        });
    });

    describe("Bug 3 - erro de email duplicado não capturado", () => {
        it("cadastrar email já existente -> 409, sem vazar detalhe do Prisma", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/users",
                payload: { name: "Outro Nome", email, password, confirmPassword: password, timezone: "America/Sao_Paulo" },
            });

            expect(res.statusCode).toBe(409);

            const raw = res.body;
            expect(raw).not.toContain("Prisma");
            expect(raw).not.toContain(".ts:");
            expect(raw).not.toContain("Área de trabalho");
        });
    });
});
