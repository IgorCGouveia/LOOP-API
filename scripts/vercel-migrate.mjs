// Roda `prisma migrate deploy` no build da Vercel, em produção e em preview.
//
// Por quê no build e não no start: numa Function não existe "start". O
// `npm start` (migrate + node dist/server.js) continua valendo para hosts
// com processo de longa duração.
//
// Por quê também em preview: produção e preview usam bancos diferentes. As
// variáveis DATABASE_URL/DIRECT_URL do ambiente production apontam para a
// branch `production` do Neon; as do ambiente preview apontam para a branch
// `preview`, que não tem dados de usuários. Migrar no preview testa a
// migração antes de ela chegar em produção. Se as variáveis de preview
// voltarem a apontar para o banco de produção, este script passa a migrar
// produção com schema não aprovado — por isso a separação está documentada
// no README (seção Deployment).
//
// Por quê DIRECT_URL: a DATABASE_URL de runtime aponta pro pooler
// (PgBouncer, modo transação), que não suporta o advisory lock que o
// migrate usa. Migração vai pela conexão direta.
import { execSync } from "node:child_process";

const env = process.env.VERCEL_ENV;
if (env !== "production" && env !== "preview") {
    console.log(`[migrate] VERCEL_ENV=${env ?? "unset"} — pulando migrate deploy.`);
    process.exit(0);
}

// DATABASE_URL_UNPOOLED é o nome que a integração Neon da Vercel injeta.
const url = process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
    console.error("[migrate] DIRECT_URL/DATABASE_URL_UNPOOLED/DATABASE_URL ausentes.");
    process.exit(1);
}

console.log(`[migrate] VERCEL_ENV=${env} — aplicando migrações pendentes.`);
execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
});
