import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { prisma } from "../db";
import * as checkinRepository from "../repositories/checkinRepository";
import { createBarrier, type Barrier } from "./helpers/barrier";

// Corridas determinísticas (issues #18 e #20, ADR-0009). Em vez de torcer
// pelo timing, uma barreira segura as requisições num ponto exato do caso
// de uso até as duas chegarem lá.
let checkinBarrier: Barrier | null = null;
let findHabitBarrier: Barrier | null = null;

vi.mock("../repositories/checkinRepository", async (importOriginal) => {
    const real = await importOriginal<typeof import("../repositories/checkinRepository")>();
    return {
        ...real,
        lockHabit: vi.fn(real.lockHabit),
        // ponto da barreira: logo depois de ler o log, antes de qualquer
        // escrita do check-in — é aqui que duas requisições sem trava
        // enxergam o mesmo dia pulado.
        getEffectiveLog: vi.fn(async (...args: Parameters<typeof real.getEffectiveLog>) => {
            const result = await real.getEffectiveLog(...args);
            // args[2] é o tx: uma chave por requisição, então a 2ª leitura
            // do mesmo check-in não conta como "a outra requisição chegou"
            await checkinBarrier?.arrive(args[2]);
            return result;
        }),
    };
});

vi.mock("../services/habitServices", async (importOriginal) => {
    const real = await importOriginal<typeof import("../services/habitServices")>();
    return {
        ...real,
        // ponto da barreira: depois da checagem de existência/dono, antes
        // do delete — os dois DELETE passam pela checagem com o hábito vivo.
        FindHabit: vi.fn(async (id: string) => {
            const habit = await real.FindHabit(id);
            await findHabitBarrier?.arrive();
            return habit;
        }),
    };
});

const repo = vi.mocked(checkinRepository);
const at = (iso: string) => new Date(`${iso}T15:00:00.000Z`); // 12:00 em São Paulo
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("requisições paralelas no mesmo hábito", () => {
    let app: FastifyInstance;
    let userId: string;
    let token: string;
    const auth = () => ({ authorization: `Bearer ${token}` });
    const checkin = (habitId: string) => app.inject({ method: "POST", url: `/habits/${habitId}/checkin`, headers: auth() });

    // check-in na segunda, relógio na quarta: o próximo check-in tem 1 dia
    // pulado (terça) e gasta o único token.
    async function habitWithOneDayGap(name: string) {
        vi.setSystemTime(at("2026-11-16"));
        const created = await app.inject({ method: "POST", url: "/habits", headers: auth(), payload: { name } });
        const habitId = created.json().data.id as string;
        expect((await checkin(habitId)).statusCode).toBe(201);
        vi.setSystemTime(at("2026-11-18"));
        return habitId;
    }

    beforeAll(async () => {
        app = buildApp();
        await app.ready();
        const user = await prisma.user.create({
            data: { name: "Usuário Concorrência", email: `concurrency-${Date.now()}@example.com`, password: "hash-fake", timezone: "America/Sao_Paulo" },
        });
        userId = user.id;
        token = jwt.sign({ id: userId, role: "USER" }, process.env.SECRET_KEY as string, { expiresIn: "3650d" });
    });

    afterEach(() => {
        checkinBarrier = null;
        findHabitBarrier = null;
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    afterAll(async () => {
        await prisma.habit.deleteMany({ where: { userId } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
        await app.close();
        await prisma.$disconnect();
    });

    it("sem a trava, a corrida acontece: os dois veem a terça pulada e um bate no unique de GraceFill", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const habitId = await habitWithOneDayGap("Sem trava");

        // simula o código de antes do ADR-0009: nenhuma trava na linha do
        // hábito, só nas duas chamadas deste teste (Once, pra não vazar
        // pro próximo — clearAllMocks não restaura implementação)
        repo.lockHabit.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {});
        checkinBarrier = createBarrier(2);

        const responses = await Promise.all([checkin(habitId), checkin(habitId)]);

        expect(checkinBarrier.releasedBy).toBe("parties");
        expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
        const loser = responses.find((r) => r.statusCode === 409)!;
        // mensagem do #18, não mais "Email já cadastrado."
        expect(loser.json()).toEqual({ error: "Outra operação no mesmo hábito terminou antes desta. Tente de novo." });
        // a transação do perdedor voltou inteira: nenhum CHECKIN dele ficou
        expect(await prisma.habitLog.count({ where: { habitId, kind: "CHECKIN", date: day("2026-11-18") } })).toBe(1);
    });

    it("com a trava, a 2ª requisição espera a 1ª: os dois check-ins gravam e o token é gasto uma vez", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const habitId = await habitWithOneDayGap("Com trava");
        checkinBarrier = createBarrier(2, 500);

        const responses = await Promise.all([checkin(habitId), checkin(habitId)]);

        // a 2ª nunca chegou à barreira enquanto a 1ª estava lá: ficou presa
        // no SELECT ... FOR UPDATE
        expect(checkinBarrier.releasedBy).toBe("timeout");
        expect(responses.map((r) => r.statusCode)).toEqual([201, 201]);
        expect(await prisma.habitLog.count({ where: { habitId, kind: "CHECKIN", date: day("2026-11-18") } })).toBe(2);
        expect(await prisma.graceFill.count({ where: { habitId } })).toBe(1);
        const habit = await prisma.habit.findUniqueOrThrow({ where: { id: habitId } });
        expect(habit.graceTokens).toBe(0);
    });

    it("dois DELETE que passam juntos pela checagem: um apaga, o outro bate no P2025 e recebe 404", async () => {
        const created = await app.inject({ method: "POST", url: "/habits", headers: auth(), payload: { name: "Apagar 2x" } });
        const habitId = created.json().data.id as string;
        findHabitBarrier = createBarrier(2);

        const responses = await Promise.all([
            app.inject({ method: "DELETE", url: `/habits/${habitId}`, headers: auth() }),
            app.inject({ method: "DELETE", url: `/habits/${habitId}`, headers: auth() }),
        ]);

        // os dois acharam o hábito vivo na checagem
        expect(findHabitBarrier.releasedBy).toBe("parties");
        expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 404]);
        // a mensagem do errorHandler (P2025), não a do "hábito não existe"
        expect(responses.find((r) => r.statusCode === 404)!.json()).toEqual({ error: "Registro não encontrado." });
    });
});
