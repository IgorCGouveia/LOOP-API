// Roda `prisma migrate deploy` no build da Vercel — mas só em produção.
//
// Por quê no build e não no start: numa Function não existe "start". O
// `npm start` (migrate + node dist/server.js) continua valendo para hosts
// com processo de longa duração.
//
// Por quê só em produção: deploys de preview (toda branch/PR) não podem
// migrar o banco de produção com um schema que ainda não foi aprovado.
//
// Por quê DIRECT_URL: a DATABASE_URL de runtime aponta pro pooler
// (PgBouncer, modo transação), que não suporta o advisory lock que o
// migrate usa. Migração vai pela conexão direta.
import { execSync } from "node:child_process";

if (process.env.VERCEL_ENV !== "production") {
    console.log(`[migrate] VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"} — pulando migrate deploy.`);
    process.exit(0);
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
    console.error("[migrate] DIRECT_URL/DATABASE_URL ausentes.");
    process.exit(1);
}

execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
});
