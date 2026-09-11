import { describe, it, expect } from "vitest";
import { validateSecretKey, MIN_SECRET_KEY_LENGTH } from "../config/secretKey";

describe("validateSecretKey (guard de boot)", () => {
    const chaveForte = "x9K2mPq7wLz4Rt8vNb3cHd6sYf1gJ0aE"; // 32 chars, não-placeholder

    it("aceita chave forte (>= mínimo, não-placeholder)", () => {
        expect(chaveForte.length).toBeGreaterThanOrEqual(MIN_SECRET_KEY_LENGTH);
        expect(() => validateSecretKey(chaveForte)).not.toThrow();
    });

    it("rejeita SECRET_KEY ausente (undefined)", () => {
        expect(() => validateSecretKey(undefined)).toThrow(/não está definida/i);
    });

    it("rejeita string vazia", () => {
        expect(() => validateSecretKey("")).toThrow(/não está definida/i);
    });

    it("rejeita string só com espaços", () => {
        expect(() => validateSecretKey("   ")).toThrow(/não está definida/i);
    });

    it("rejeita chave curta (< mínimo)", () => {
        expect(() => validateSecretKey("abc123")).toThrow(/curta demais/i);
    });

    it("rejeita chave com exatamente mínimo - 1 caractere", () => {
        const curta = "a".repeat(MIN_SECRET_KEY_LENGTH - 1);
        expect(() => validateSecretKey(curta)).toThrow(/curta demais/i);
    });

    it("rejeita o valor de exemplo do .env do projeto", () => {
        expect(() => validateSecretKey("abcdefghijklmnopqrstuvwxyz")).toThrow();
    });

    it("rejeita placeholder conhecido mesmo com comprimento suficiente", () => {
        const placeholder = "your-super-secret-key-change-this-please";
        expect(placeholder.length).toBeGreaterThanOrEqual(MIN_SECRET_KEY_LENGTH);
        expect(() => validateSecretKey(placeholder)).toThrow(/placeholder|exemplo/i);
    });

    it("compara placeholder ignorando caixa e espaços nas bordas", () => {
        expect(() =>
            validateSecretKey("  YOUR-SUPER-SECRET-KEY-CHANGE-THIS-PLEASE  "),
        ).toThrow(/placeholder|exemplo/i);
    });
});
