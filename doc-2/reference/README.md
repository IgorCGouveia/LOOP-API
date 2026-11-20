# Referência

## Contrato HTTP

A referência atual é [`docs/API-REFERENCE.md`](../../docs/API-REFERENCE.md).
Ela ainda não foi migrada para cá. Copiar o conteúdo agora criaria duas
fontes que iam divergir.

O padrão de mercado para isso é uma especificação **OpenAPI 3** gerada a
partir das rotas, por exemplo com `@fastify/swagger` mais os schemas Zod.
Assim a doc não fica desatualizada em relação ao código. Isso adiciona
uma dependência nova, então só entra se for aprovado.

### Divergências conhecidas entre a doc e o código

Nenhuma aberta no momento.

Resolvidas:

| Seção | Divergência | Resolução |
|---|---|---|
| `PATCH /users/:id` e "Fuso horário mostrado pro usuário" | A doc se contradizia: uma seção aceitava `timezone` no PATCH e outra dizia que ele não mudava. O código aceitava. | Issue #15, [ADR-0002](../adr/0002-timezone-do-usuario-apos-cadastro.md). O código passou a rejeitar, e as duas seções foram alinhadas. |

## Configuração (variáveis de ambiente)

| Variável | Obrigatória | Uso |
|---|---|---|
| `DATABASE_URL` | sim | Conexão com o PostgreSQL usada pela app. Em produção (Neon), a URL **pooled** ([ADR-0005](../adr/0005-conexao-pooled-e-direta-no-neon.md)). |
| `DIRECT_URL` | só em produção | URL direta (sem pooler) usada pelo CLI do Prisma nas migrations (`prisma.config.ts`). Sem ela, o CLI usa a `DATABASE_URL`. |
| `SECRET_KEY` | sim | Assinatura do JWT. O boot falha se ela estiver ausente, curta ou com valor de exemplo (`src/config/secretKey.ts`). |
| `CORS_ORIGIN` | não | Origens liberadas, separadas por vírgula. Só o `loop-web` precisa. |
| `NODE_ENV` | em produção | `production` liga `secure` + `sameSite=none` no cookie de refresh (`src/config/cookies.ts`). |
| `PORT` / `HOST` | não | Padrão `3333` / `0.0.0.0`. Ignoradas na Vercel (não há `listen()`, ver [ADR-0003](../adr/0003-hospedar-api-na-vercel.md)). |

Onde configurar cada uma em produção: [guia de deploy](../guides/deploy-vercel.md).

## Hospedagem

| | |
|---|---|
| API | Vercel, função serverless (`api/index.js`), URL `<URL_DA_API>` |
| Banco | Neon (Postgres), `us-east-1` |
| Front | Vercel, projeto separado (`loop-web`), com rewrite `/api/*` → API |
