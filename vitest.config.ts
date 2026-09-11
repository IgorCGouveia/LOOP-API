import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
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
