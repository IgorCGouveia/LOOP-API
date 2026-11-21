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
                // pontos de entrada de CLI (só leem argv e chamam a lógica,
                // que fica em módulos testados, ex.: habitScheduleBackfill.ts)
                "src/scripts/audit-integrity.ts",
                "src/scripts/backfill-habit-schedules.ts",
                "src/scripts/fix-backfill-effective-from.ts",
            ],
            // Piso, não meta: fica um pouco abaixo do valor medido para a
            // suíte não quebrar por oscilação, e só sobe (ver
            // doc-2/architecture/testing-strategy.md, "Cobertura").
            // Os arquivos de segurança e integridade têm piso próprio.
            thresholds: {
                lines: 95,
                statements: 94,
                branches: 87,
                functions: 91,
                "src/Middleware/Auth.ts": { lines: 100, branches: 100 },
                "src/Middleware/habitAccess.ts": { lines: 100, branches: 80 },
                "src/Middleware/errorHandler.ts": { lines: 100, branches: 80 },
                "src/services/checkinServices.ts": { lines: 90, branches: 80 },
                "src/controllers/CheckinController.ts": { lines: 90, branches: 85 },
            },
        },
    },
});
