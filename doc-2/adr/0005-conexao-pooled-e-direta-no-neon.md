# ADR-0005: Conexão com o Neon: pooled para a app, direta para migrations

- **Status:** Aceito (opção A)
- **Data:** 2026-11-20
- **Decisor:** decisão delegada pelo dono do projeto em 2026-11-20. Pendente de revisão.
- **Relacionado:** [ADR-0003](./0003-hospedar-api-na-vercel.md), [ADR-0004](./0004-migrations-no-build-de-producao.md)

## Contexto

O Neon oferece duas URLs para o mesmo banco: a direta e a pooled (com
`-pooler` no host, passando pelo PgBouncer em modo transaction).

- Em serverless, cada instância da função abre o próprio pool de
  conexões. Sem pooler, picos de instâncias esgotam o limite de conexões
  do Postgres.
- `prisma migrate deploy` usa advisory lock, que não funciona pelo
  PgBouncer em modo transaction. Migration precisa da URL direta.
- O projeto usa `prisma.config.ts` com `engine: "classic"`. Os tipos do
  Prisma 6.19.3 (`@prisma/config`, `SchemaEngineConfigClassicDatasource`)
  aceitam `url`, `directUrl` e `shadowDatabaseUrl`, e dizem que esses
  campos sobrescrevem os do bloco `datasource` do schema. Esse arquivo só
  é lido pelo CLI. O Prisma Client em runtime lê `url` do
  `prisma/schema.prisma`.

## Opções consideradas

### Opção A: `directUrl` opcional no `prisma.config.ts`
- `DATABASE_URL` = pooled (runtime), `DIRECT_URL` = direta (CLI).
- Ganha: `schema.prisma` intocado. Sem `DIRECT_URL` (dev local, CI), o
  CLI usa a própria `url`, então nada quebra.
- Perde: a configuração da URL fica em dois arquivos.

### Opção B: `directUrl = env("DIRECT_URL")` no `schema.prisma`
- Ganha: é o padrão mais documentado.
- Perde: `env()` no schema torna a variável obrigatória em todo lugar
  (CI, `.env` local, `prisma generate`). Além disso, o config sobrescreve
  o schema mesmo assim.

### Opção C: só a URL direta, sem pooler
- Ganha: nenhuma mudança de código.
- Perde: risco de esgotar conexões sob carga em serverless.

## Decisão

Opção A. `prisma.config.ts:20` usa `directUrl: process.env.DIRECT_URL`,
e não o helper `env()`, que lança erro se a variável faltar.

## Consequências

- Em produção, as duas variáveis são obrigatórias. Se faltar `DIRECT_URL`,
  o migrate do build tenta pela URL pooled e pode travar ou falhar no
  advisory lock.
- O parâmetro `channel_binding=require`, que o painel do Neon inclui por
  padrão, foi tirado das URLs. A documentação do Neon para Prisma usa só
  `sslmode=require`. A conexão continua com TLS.
- Não foi adotado o driver adapter (`@prisma/adapter-neon` /
  `attachDatabasePool`), porque exigiria dependência nova. Fica como
  opção se a latência de conexão virar problema.
