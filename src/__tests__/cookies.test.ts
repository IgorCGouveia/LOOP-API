import { describe, it, expect, afterEach, vi } from "vitest";

// Opções do cookie de refresh (src/config/cookies.ts). O ramo de produção
// só roda no deploy: um sameSite ou secure errado ali faz o navegador
// descartar o cookie em silêncio e o /refresh para de funcionar.
// isProduction é lido quando o módulo carrega, então cada caso troca o
// NODE_ENV e importa o módulo de novo.
async function loadWith(nodeEnv: string | undefined) {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", nodeEnv as string);
    return import("../config/cookies");
}

describe("refreshCookieOptions", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it("produção: httpOnly, secure e sameSite none (front e API em domínios diferentes)", async () => {
        const { refreshCookieOptions } = await loadWith("production");
        expect(refreshCookieOptions()).toEqual({ httpOnly: true, secure: true, sameSite: "none", path: "/" });
    });

    it.each(["development", "test", undefined])("fora de produção (%s): sameSite lax e sem secure, para funcionar em http://localhost", async (env) => {
        const { refreshCookieOptions } = await loadWith(env);
        expect(refreshCookieOptions()).toEqual({ httpOnly: true, secure: false, sameSite: "lax", path: "/" });
    });

    it("sameSite none nunca sai sem secure (o navegador recusaria o cookie)", async () => {
        for (const env of ["production", "development", "test"]) {
            const { refreshCookieOptions } = await loadWith(env);
            const options = refreshCookieOptions();
            if (options.sameSite === "none") expect(options.secure, env).toBe(true);
        }
    });

    it("httpOnly é sempre true: o cookie de refresh nunca fica legível por JavaScript", async () => {
        for (const env of ["production", "development"]) {
            const { refreshCookieOptions } = await loadWith(env);
            expect(refreshCookieOptions().httpOnly).toBe(true);
        }
    });
});
