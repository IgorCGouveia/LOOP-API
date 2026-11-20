import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { errorHandler } from "../Middleware/errorHandler";
import { Prisma } from "../generated/prisma";

// issue #18: cada constraint tem a própria resposta; P2025 vira 404.
describe("errorHandler: erros conhecidos do Prisma", () => {
    function knownError(code: string, meta: Record<string, unknown>) {
        return new Prisma.PrismaClientKnownRequestError("erro de teste", { code, clientVersion: "test", meta });
    }

    async function responseFor(error: Error) {
        const app = Fastify();
        app.setErrorHandler(errorHandler);
        app.get("/boom", async () => {
            throw error;
        });
        const res = await app.inject({ method: "GET", url: "/boom" });
        await app.close();
        return { status: res.statusCode, body: res.json() };
    }

    it("P2002 em User.email mantém a mensagem de email", async () => {
        expect(await responseFor(knownError("P2002", { modelName: "User", target: ["email"] }))).toEqual({
            status: 409,
            body: { error: "Email já cadastrado." },
        });
    });

    it.each([
        ["GraceFill", ["habitId", "date"]],
        ["HabitLog", ["undoesId"]],
    ])("P2002 em %s vira conflito de operação simultânea no hábito", async (modelName, target) => {
        const { status, body } = await responseFor(knownError("P2002", { modelName, target }));
        expect(status).toBe(409);
        expect(body.error).toBe("Outra operação no mesmo hábito terminou antes desta. Tente de novo.");
    });

    it("P2002 em qualquer outro unique vira 409 genérico", async () => {
        expect(await responseFor(knownError("P2002", { modelName: "RefreshToken", target: ["tokenHash"] }))).toEqual({
            status: 409,
            body: { error: "Registro duplicado." },
        });
    });

    it("P2025 vira 404", async () => {
        expect(await responseFor(knownError("P2025", { modelName: "Habit", cause: "No record was found for a delete." }))).toEqual({
            status: 404,
            body: { error: "Registro não encontrado." },
        });
    });
});

// as corridas reais (check-ins e DELETE paralelos) ficam em
// concurrency.test.ts, com barreira pra serem determinísticas.
