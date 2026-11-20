import fs from "fs";
import path from "path";
import { PrismaClient } from "../generated/prisma/client";

// Roda uma vez antes da suíte, no processo principal do Vitest. Os testes
// de integração gravam num Postgres de verdade, então antes de começar:
// 1. as variáveis existem;
// 2. o banco é local (ou é o CI) — rodar contra produção cria usuários e
//    hábitos de teste lá;
// 3. o banco responde e as migrações estão aplicadas.
// Sem isso, a suíte falhava em 7 testes e pulava 46 sem dizer por quê.

const HOW_TO = [
    "Para subir o banco de teste local:",
    "  cp .env.test.example .env.test",
    "  npm run test:db:up",
    "  npx prisma migrate deploy   (com as variáveis do .env.test)",
    "  npm test",
    "Detalhes: README.md, seção \"Testes\" (ou \"Tests\").",
].join("\n");

function fail(problem: string): never {
    throw new Error(`\n[testes] ${problem}\n\n${HOW_TO}\n`);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export default async function setup() {
    const { DATABASE_URL, SECRET_KEY } = process.env;

    if (!DATABASE_URL) fail("DATABASE_URL não está definida.");
    if (!SECRET_KEY) fail("SECRET_KEY não está definida (os testes assinam e conferem JWT).");

    let host: string;
    try {
        host = new URL(DATABASE_URL).hostname;
    } catch {
        fail("DATABASE_URL não é uma URL válida.");
    }

    const remoteAllowed = process.env.CI === "true" || process.env.LOOP_TEST_ALLOW_REMOTE_DB === "1";
    if (!LOCAL_HOSTS.has(host) && !remoteAllowed) {
        fail(
            `DATABASE_URL aponta para "${host}", que não é local. Os testes criam e apagam dados de verdade.\n` +
                "Se esse banco é mesmo descartável, rode com LOOP_TEST_ALLOW_REMOTE_DB=1.",
        );
    }

    const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    try {
        try {
            await prisma.$queryRaw`SELECT 1`;
        } catch (err) {
            // o Prisma põe o motivo (ex.: "Can't reach database server") na última linha
            const reason = (err as Error).message.split("\n").map((line) => line.trim()).filter(Boolean).pop() ?? "sem detalhe";
            fail(`não consegui conectar no banco de teste: ${reason}`);
        }

        const migrationsDir = path.resolve(__dirname, "../../prisma/migrations");
        const expected = fs
            .readdirSync(migrationsDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);

        let applied: string[] = [];
        try {
            const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
                SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
            applied = rows.map((r) => r.migration_name);
        } catch {
            // tabela ainda não existe: nenhuma migração aplicada
        }

        const missing = expected.filter((name) => !applied.includes(name));
        if (missing.length > 0) {
            fail(`migrações não aplicadas no banco de teste: ${missing.join(", ")}. Rode npx prisma migrate deploy.`);
        }
    } finally {
        await prisma.$disconnect();
    }
}
