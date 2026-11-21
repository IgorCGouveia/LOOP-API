import { describe, it, expect } from "vitest";
import { CreateUserVal, UpdateUserVal } from "../schema/userVal";
import { CreateHabitVal, ScheduleVal, UpdateHabitVal } from "../schema/habitVal";

// Testes unitários dos schemas Zod: limites e regras cruzadas, sem HTTP
// nem banco. O comportamento pelas rotas fica nos testes de integração.
const validUser = {
    name: "Ana Souza",
    email: "ana@example.com",
    password: "senha12345",
    confirmPassword: "senha12345",
    timezone: "America/Sao_Paulo",
};

describe("CreateUserVal", () => {
    it("aceita um cadastro válido", () => {
        expect(CreateUserVal.safeParse(validUser).success).toBe(true);
    });

    it.each([
        ["nome com 2 letras", { name: "Al" }],
        ["nome com 51 letras", { name: "x".repeat(51) }],
        ["senha com 7 caracteres", { password: "1234567", confirmPassword: "1234567" }],
        ["senha com 129 caracteres", { password: "x".repeat(129), confirmPassword: "x".repeat(129) }],
        ["senhas diferentes", { confirmPassword: "senha99999" }],
        ["timezone abreviado", { timezone: "BRT" }],
        ["timezone com offset", { timezone: "UTC-03:00" }],
    ])("rejeita %s", (_caso, override) => {
        expect(CreateUserVal.safeParse({ ...validUser, ...override }).success).toBe(false);
    });

    it.each([
        ["nome com 3 letras", { name: "Ana" }],
        ["nome com 50 letras", { name: "x".repeat(50) }],
        ["senha com 8 caracteres", { password: "12345678", confirmPassword: "12345678" }],
        ["senha com 128 caracteres", { password: "x".repeat(128), confirmPassword: "x".repeat(128) }],
        ["timezone UTC", { timezone: "UTC" }],
    ])("aceita o limite: %s", (_caso, override) => {
        expect(CreateUserVal.safeParse({ ...validUser, ...override }).success).toBe(true);
    });
});

describe("UpdateUserVal", () => {
    it("aceita objeto vazio (o controller é quem responde 400 para corpo vazio)", () => {
        expect(UpdateUserVal.safeParse({}).success).toBe(true);
    });

    it("aceita só o nome", () => {
        expect(UpdateUserVal.parse({ name: "Novo Nome" })).toEqual({ name: "Novo Nome" });
    });

    it("password sem confirmPassword é rejeitado", () => {
        expect(UpdateUserVal.safeParse({ password: "senha12345" }).success).toBe(false);
    });

    it("confirmPassword sozinho é rejeitado", () => {
        expect(UpdateUserVal.safeParse({ confirmPassword: "senha12345" }).success).toBe(false);
    });

    it.each(["timezone", "role", "id", "createdAt"])("chave fora da allowlist (%s) é rejeitada", (key) => {
        const result = UpdateUserVal.safeParse({ name: "Novo Nome", [key]: "x" });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toBe(`Campo não pode ser alterado: ${key}.`);
    });
});

describe("ScheduleVal", () => {
    it.each([
        [{ type: "DAILY", targetPerDay: 1 }],
        [{ type: "WEEKLY", targetPerDay: 2, daysOfWeek: [0, 6] }],
        [{ type: "INTERVAL", targetPerDay: 1, intervalDays: 1 }],
    ])("aceita %o", (schedule) => {
        expect(ScheduleVal.safeParse(schedule).success).toBe(true);
    });

    it("descarta campos de outra variante (DAILY com daysOfWeek)", () => {
        expect(ScheduleVal.parse({ type: "DAILY", targetPerDay: 1, daysOfWeek: [1] })).toEqual({ type: "DAILY", targetPerDay: 1 });
    });

    it.each([
        ["dia da semana negativo", { type: "WEEKLY", targetPerDay: 1, daysOfWeek: [-1] }],
        ["intervalDays zero", { type: "INTERVAL", targetPerDay: 1, intervalDays: 0 }],
        ["targetPerDay negativo", { type: "DAILY", targetPerDay: -1 }],
        ["sem type", { targetPerDay: 1 }],
    ])("rejeita %s", (_caso, schedule) => {
        expect(ScheduleVal.safeParse(schedule).success).toBe(false);
    });
});

describe("CreateHabitVal / UpdateHabitVal", () => {
    const userId = "ckv9q1z0h0000qzrmn831i7rn"; // formato cuid2

    it("nome com espaços nas pontas é aparado antes de contar o tamanho", () => {
        expect(CreateHabitVal.parse({ name: "  Ler  ", userId }).name).toBe("Ler");
        expect(CreateHabitVal.safeParse({ name: "  ab  ", userId }).success).toBe(false);
    });

    it("descrição com 251 caracteres é rejeitada", () => {
        expect(CreateHabitVal.safeParse({ name: "Ler", userId, description: "x".repeat(251) }).success).toBe(false);
    });

    it("userId fora do formato cuid2 (maiúsculas, hífen) é rejeitado", () => {
        expect(CreateHabitVal.safeParse({ name: "Ler", userId: "Usuario-123" }).success).toBe(false);
    });

    it("UpdateHabitVal descarta userId: não dá para trocar o dono pelo PATCH", () => {
        expect(UpdateHabitVal.parse({ name: "Ler", userId })).toEqual({ name: "Ler" });
    });
});
