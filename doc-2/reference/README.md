# Referência

## Contrato HTTP

A referência campo a campo é a spec OpenAPI em
[`docs/openapi.yaml`](../../docs/openapi.yaml), servida pelo próprio app em
`/docs` (Swagger UI) e `/docs/json`. Um teste
(`src/__tests__/openapi.test.ts`) falha se uma rota registrada não estiver
na spec ou se a spec tiver rota que não existe. Ele não confere os campos:
mudou um schema Zod, atualize o YAML no mesmo PR. Ver
[ADR-0003](../adr/0003-documentacao-openapi.md).

O [`docs/API-REFERENCE.md`](../../docs/API-REFERENCE.md) continua como guia
para quem constrói um cliente: fluxo de refresh, CORS e onde guardar o token.

### Divergências conhecidas entre a doc e o código

Nenhuma aberta no momento.

Resolvidas:

| Seção | Divergência | Resolução |
|---|---|---|
| `PATCH /users/:id` e "Fuso horário mostrado pro usuário" | A doc se contradizia: uma seção aceitava `timezone` no PATCH e outra dizia que ele não mudava. O código aceitava. | Issue #15, [ADR-0002](../adr/0002-timezone-do-usuario-apos-cadastro.md). O código passou a rejeitar, e as duas seções foram alinhadas. |

## Configuração (variáveis de ambiente)

| Variável | Obrigatória | Uso |
|---|---|---|
| `DATABASE_URL` | sim | Conexão com o PostgreSQL |
| `SECRET_KEY` | sim | Assinatura do JWT. O boot falha se ela estiver ausente, curta ou com valor de exemplo (`src/config/secretKey.ts`). |
| `CORS_ORIGIN` | não | Origens liberadas, separadas por vírgula. Só o `loop-web` precisa. |
| `DIRECT_URL` | só na Vercel | Conexão direta com o Neon, usada só pelas migrações no build (`scripts/vercel-migrate.mjs`). Na falta dela, `DATABASE_URL_UNPOOLED` e depois `DATABASE_URL`. |
| `NODE_ENV` | não | `production` deixa o cookie de refresh `Secure; SameSite=None` (`src/config/cookies.ts`). |
| `PORT` / `HOST` | não | Padrão `3333` / `0.0.0.0` |

Modelo pronto: [`.env.example`](../../.env.example).
