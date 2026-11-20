# Visão geral da arquitetura

> Conferido no commit `4fc2b5a`.

## Contexto

O LOOP é uma API REST sem frontend. Quem consome é um cliente mobile
(stack ainda não escolhida) e um cliente web (`loop-web`). A API roda no
Render e usa um PostgreSQL gerenciado.

```
[app mobile] ──┐
               ├── HTTPS/JSON ──> [LOOP API (Fastify)] ──> [PostgreSQL]
[loop-web]  ───┘
```

## Camadas

```
routes/        registra a rota, o rate limit e o preHandler de auth
  │
controllers/   valida o corpo com Zod, checa posse do recurso, monta a resposta HTTP
  │
services/      regra de negócio (streak, grace token, versão de agenda)
  │
repositories/  acesso ao banco para HabitLog, GraceFill e HabitSchedule
  │
Prisma Client  instância única, exportada por src/app.ts
```

- `src/Middleware/Auth.ts`: confere o JWT e coloca `req.user`.
  `auth.admin` também exige `role = ADMIN`.
- `src/Middleware/errorHandler.ts`: concentra o tratamento de erro.
  `ZodError` vira `400` com `details`. `P2002` do Prisma vira `409`.
  Qualquer outro erro vira `500` com `reqId` e sem detalhe interno.
- `src/repositories/checkinRepository.ts` é o único módulo que acessa
  `habitLog`, `graceFill` e `habitSchedule`. O teste
  `src/__tests__/checkinRepositoryBoundary.test.ts` garante isso.
- `src/schema/*.ts`: schemas Zod. Os tipos de entrada dos services saem
  deles com `z.infer`. Um campo que existe no schema passa a existir no
  contrato da rota.

## Contrato HTTP

- Sucesso: `{ message, data }`.
- Erro: `{ error }`, mais `details` quando a falha é de validação.
- Contrato completo: [`docs/API-REFERENCE.md`](../../docs/API-REFERENCE.md).

## Testes e CI

- Vitest com testes de integração via `app.inject()` contra um Postgres
  real, sem mock de banco.
- CI (`.github/workflows/ci.yml`): `prisma generate`, depois
  `tsc --noEmit` como checagem de tipos, depois `prisma migrate deploy`,
  depois `npm test`.

## Tempo e timezone

O sistema trata tempo de dois jeitos:

1. **Instante (UTC)**: `checkedAt`, `effectiveFromAt`, `createdAt`.
2. **Dia local**: `HabitLog.date`, `HabitSchedule.effectiveFrom/To`,
   `GraceFill.date`. Cada um é calculado com o timezone do dono **no
   momento da escrita** e salvo sem o timezone junto.

O cálculo de streak compara dias locais entre si. Isso só funciona se
todos os dias locais de um usuário foram calculados no mesmo timezone.
Ver [domain-model.md](./domain-model.md#i1-um-único-referencial-de-dia-por-usuário)
e a [investigação da issue #15](../investigations/issue-15-timezone-patch.md).

A reposição de grace token é a exceção: ela usa o calendário UTC
(`monthsElapsedUTC`) e não depende do timezone do usuário.
