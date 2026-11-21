import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { prisma } from "../db";
import { bearer, createAdmin, createHabit, createUser, deleteUsers, type TestUser } from "./helpers/factories";

// Acesso às rotas aninhadas de check-in. O POST /habits/:habitId/checkin
// já é coberto em ownership.test.ts; aqui ficam o DELETE, as duas
// listagens e os casos de "nada para desfazer".
//
// Admin nas rotas do hábito (POST/DELETE/GET /habits/:habitId/checkin(s))
// fica de fora de propósito: é o ADR-0011, ainda Proposto.
describe("Rotas aninhadas de check-in: acesso e respostas", () => {
    let app: FastifyInstance;
    let owner: TestUser;
    let other: TestUser;
    let admin: TestUser;
    let habitId: string;

    const checkin = (token: string, id = habitId) =>
        app.inject({ method: "POST", url: `/habits/${id}/checkin`, headers: bearer(token) });
    const undo = (token: string, id = habitId) =>
        app.inject({ method: "DELETE", url: `/habits/${id}/checkin`, headers: bearer(token) });
    const listByHabit = (token: string, id = habitId) =>
        app.inject({ method: "GET", url: `/habits/${id}/checkins`, headers: bearer(token) });
    const listByUser = (token: string, userId: string) =>
        app.inject({ method: "GET", url: `/users/${userId}/checkins`, headers: bearer(token) });

    beforeAll(async () => {
        app = buildApp();
        await app.ready();
        owner = await createUser({ prefix: "checkin-access-owner" });
        other = await createUser({ prefix: "checkin-access-other" });
        admin = await createAdmin({ prefix: "checkin-access-admin" });
        habitId = (await createHabit(owner.id, { name: "Meditar" })).id;
    });

    afterAll(async () => {
        await deleteUsers([owner?.id, other?.id, admin?.id]);
        await app.close();
        await prisma.$disconnect();
    });

    it("desfazer sem nenhum check-in -> 400", async () => {
        const res = await undo(owner.token);
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: "Nenhum check-in para desfazer." });
    });

    it("dono faz check-in e vê o registro nas duas listagens", async () => {
        expect((await checkin(owner.token)).statusCode).toBe(201);

        const byHabit = await listByHabit(owner.token);
        expect(byHabit.statusCode).toBe(200);
        expect(byHabit.json().data).toHaveLength(1);

        const byUser = await listByUser(owner.token, owner.id);
        expect(byUser.statusCode).toBe(200);
        expect(byUser.json().data.map((c: { habitId: string }) => c.habitId)).toEqual([habitId]);
    });

    it("não-dono não desfaz o check-in de outra pessoa (403) e o check-in continua", async () => {
        const res = await undo(other.token);
        expect(res.statusCode).toBe(403);
        expect((await listByHabit(owner.token)).json().data).toHaveLength(1);
    });

    it("não-dono não lista os check-ins do hábito de outra pessoa (403)", async () => {
        const res = await listByHabit(other.token);
        expect(res.statusCode).toBe(403);
        expect(Object.keys(res.json())).toEqual(["error"]);
    });

    it("não-dono não lista os check-ins de outro usuário (403)", async () => {
        const res = await listByUser(other.token, owner.id);
        expect(res.statusCode).toBe(403);
    });

    it("admin lista os check-ins de qualquer usuário (200)", async () => {
        const res = await listByUser(admin.token, owner.id);
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toHaveLength(1);
    });

    it("admin pedindo check-ins de um usuário que não existe -> 404", async () => {
        const res = await listByUser(admin.token, "usuario-que-nao-existe");
        expect(res.statusCode).toBe(404);
    });

    it.each([
        ["DELETE /habits/:habitId/checkin", (t: string) => undo(t, "habito-inexistente")],
        ["GET /habits/:habitId/checkins", (t: string) => listByHabit(t, "habito-inexistente")],
    ])("%s em hábito inexistente -> 404", async (_rota, call) => {
        const res = await call(owner.token);
        expect(res.statusCode).toBe(404);
    });

    it("dono desfaz (200): o check-in some das listagens, mas o evento fica no banco", async () => {
        const res = await undo(owner.token);
        expect(res.statusCode).toBe(200);
        // o recorde era a própria sequência desfeita, então é recalculado
        expect(res.json().data).toEqual({ currentStreak: 0, longestStreak: 0 });

        expect((await listByHabit(owner.token)).json().data).toEqual([]);
        expect((await listByUser(owner.token, owner.id)).json().data).toEqual([]);

        // o undo é um evento compensatório, não um DELETE
        const events = await prisma.habitLog.findMany({ where: { habitId }, select: { kind: true } });
        expect(events.map((e) => e.kind).sort()).toEqual(["CHECKIN", "UNDO"]);
    });

    it("desfazer de novo, sem check-in pendente -> 400", async () => {
        const res = await undo(owner.token);
        expect(res.statusCode).toBe(400);
    });
});
