import fs from "fs";
import { defineConfig } from "vitest/config";

// .env.test (local, fora do git) tem prioridade sobre o .env: o .env pode
// apontar pro banco de produção. Variáveis já definidas no shell (CI)
// continuam valendo — loadEnvFile não sobrescreve.
if (fs.existsSync(".env.test")) {
    process.loadEnvFile(".env.test");
}

export default defineConfig({
    test: {
        globalSetup: ["./src/__tests__/globalSetup.ts"],
        setupFiles: ["./src/__tests__/setup.ts"],
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: [
                "src/generated/**",
                "src/__tests__/**",
                "src/server.ts",
            ],
        },
    },
});
