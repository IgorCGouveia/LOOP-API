import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, prisma } from "../app";
import { attemptTracker } from "../services/attemptTracker";
import { REFRESH_COOKIE_NAME } from "../config/cookies";

// extrai o valor de um cookie da resposta de login — light-my-request
// (o motor por trás de app.inject()) já parseia Set-Cookie em res.cookies,
// mas fazemos um fallback manual pra não depender de detalhe de versão.
function cookieValue(res: any, name: string): string {
    const parsed = res.cookies?.find((c: any) => c.name === name)?.value;
    if (parsed) return parsed;

    const raw = res.headers["set-cookie"];
    const header = Array.isArray(raw) ? raw.join(";") : (raw as string | undefined) ?? "";
    return new RegExp(`${name}=([^;]+)`).exec(header)?.[1] ?? "";
}

describe("Refresh token (cookie httpOnly, sem rotação)", () => {
    let app: FastifyInstance;
    const password = "senha12345";
    const email = `refresh-${Date.now()}@example.com`;
    let userId: string | undefined;

    afterEach(() => attemptTracker.reset());

    beforeAll(async () => {
        app = buildApp();
        await app.ready();

        const createRes = await app.inject({
            method: "POST",
            url: "/users",
            payload: { name: "Usuário Refresh", email, password, confirmPassword: password, timezone: "America/Sao_Paulo" },
        });
        userId = createRes.json().data.id;
    });

    afterAll(async () => {
        if (userId) {
            await prisma.refreshToken.deleteMany({ where: { userId } }).catch(() => {});
            await prisma.user.delete({ where: { id: userId } }).catch(() => {});
        }
        await app.close();
        await prisma.$disconnect();
    });

    it("login seta o cookie httpOnly de refresh", async () => {
        const res = await app.inject({ method: "POST", url: "/login", payload: { email, password } });
        expect(res.statusCode).toBe(200);

        const raw = res.headers["set-cookie"];
        const header = Array.isArray(raw) ? raw.join(";") : (raw as string | undefined) ?? "";
        expect(header).toContain(`${REFRESH_COOKIE_NAME}=`);
        expect(header.toLowerCase()).toContain("httponly");
    });

    it("POST /refresh com cookie válido devolve um accessToken novo", async () => {
        const loginRes = await app.inject({ method: "POST", url: "/login", payload: { email, password } });
        const token = cookieValue(loginRes, REFRESH_COOKIE_NAME);

        const res = await app.inject({
            method: "POST",
            url: "/refresh",
            headers: { cookie: `${REFRESH_COOKIE_NAME}=${token}` },
        });

        expect(res.statusCode).toBe(200);
        expect(typeof res.json().data.accessToken).toBe("string");
    });

    it("POST /refresh sem cookie -> 401", async () => {
        const res = await app.inject({ method: "POST", url: "/refresh" });
        expect(res.statusCode).toBe(401);
    });

    it("POST /refresh com cookie inventado -> 401", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/refresh",
            headers: { cookie: `${REFRESH_COOKIE_NAME}=token-que-nao-existe` },
        });
        expect(res.statusCode).toBe(401);
    });

    it("POST /refresh com refresh token expirado -> 401", async () => {
        const loginRes = await app.inject({ method: "POST", url: "/login", payload: { email, password } });
        const token = cookieValue(loginRes, REFRESH_COOKIE_NAME);

        // sem esperar 7 dias de verdade: força a expiração direto no banco,
        // mesmo padrão já usado nos smoke tests de grace period.
        const { createHash } = await import("node:crypto");
        await prisma.refreshToken.updateMany({
            where: { tokenHash: createHash("sha256").update(token).digest("hex") },
            data: { expiresAt: new Date(Date.now() - 1000) },
        });

        const res = await app.inject({
            method: "POST",
            url: "/refresh",
            headers: { cookie: `${REFRESH_COOKIE_NAME}=${token}` },
        });
        expect(res.statusCode).toBe(401);
    });

    it("POST /logout revoga o refresh token — refresh subsequente com o mesmo cookie falha", async () => {
        const loginRes = await app.inject({ method: "POST", url: "/login", payload: { email, password } });
        const token = cookieValue(loginRes, REFRESH_COOKIE_NAME);

        const logoutRes = await app.inject({
            method: "POST",
            url: "/logout",
            headers: { cookie: `${REFRESH_COOKIE_NAME}=${token}` },
        });
        expect(logoutRes.statusCode).toBe(200);

        const refreshRes = await app.inject({
            method: "POST",
            url: "/refresh",
            headers: { cookie: `${REFRESH_COOKIE_NAME}=${token}` },
        });
        expect(refreshRes.statusCode).toBe(401);
    });

    it("POST /logout sem cookie nenhum -> 200 (idempotente, não é erro)", async () => {
        const res = await app.inject({ method: "POST", url: "/logout" });
        expect(res.statusCode).toBe(200);
    });
});
