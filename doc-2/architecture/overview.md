# Visão geral da arquitetura

> Conferido no commit `4fc2b5a`. Camadas, erros e transações revistos no PR das issues #16–#23.

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
routes/        registra a rota, o rate limit e os preHandlers (auth, acesso ao hábito)
  │
controllers/   valida o corpo com Zod, monta a resposta HTTP
  │
services/      regra de negócio (streak, grace token, versão de agenda);
  │            define a transação de cada caso de uso
  │
repositories/  acesso ao banco para HabitLog, GraceFill e HabitSchedule
  │
src/db.ts      PrismaClient, instância única

src/domain/    regras puras de agenda (isTargetDay, targetDaysBetween,
               isCompleted), sem import de banco
```

`src/app.ts` é só a raiz HTTP e só `src/server.ts` importa dele
(`src/__tests__/layering.test.ts`). Antes o client morava em `app.ts`, e
importar qualquer service carregava o app inteiro (issue #22).

- `src/Middleware/Auth.ts`: confere o JWT e coloca `req.user`.
  `auth.admin` também exige `role = ADMIN`.
- `src/Middleware/habitAccess.ts`: `requireHabitAccess(action)` carrega
  o hábito da rota, aplica a política de acesso de cada ação (hoje, só o
  dono, ver [ADR-0005](../adr/0005-politica-de-acesso-ao-habito.md)) e
  deixa o hábito em `req.habit`.
- `src/Middleware/errorHandler.ts`: concentra o tratamento de erro.
  `ZodError` vira `400` com `details`. `P2002` do Prisma vira `409` com
  mensagem por constraint (email, operação simultânea no hábito, ou
  genérica). `P2025` vira `404`. Qualquer outro erro vira `500` com
  `reqId` e sem detalhe interno.
- `src/repositories/checkinRepository.ts` é o único módulo que acessa
  `habitLog`, `graceFill` e `habitSchedule`, pelo client global ou por um
  `tx`. O teste `src/__tests__/checkinRepositoryBoundary.test.ts`
  garante isso.
- `src/schema/*.ts`: schemas Zod. Os tipos de entrada dos services saem
  deles com `z.infer`. Um campo que existe no schema passa a existir no
  contrato da rota.

## Transações

Cada caso de uso que grava mais de uma linha roda em
`prisma.$transaction` no service: criar e editar hábito, check-in e
undo. As funções do repositório recebem o `tx` no último parâmetro.
Check-in e undo travam a linha do hábito (`SELECT ... FOR UPDATE`) antes
de ler, então requisições paralelas no mesmo hábito entram em fila. Ver
[ADR-0003](../adr/0003-unidade-de-trabalho-por-caso-de-uso.md).

## Contrato HTTP

- Sucesso: `{ message, data }`.
- Erro: `{ error }`, mais `details` quando a falha é de validação.
- Contrato completo: [`docs/API-REFERENCE.md`](../../docs/API-REFERENCE.md).

## Testes e CI

- Vitest com testes de integração via `app.inject()` contra um Postgres
  real, sem mock de banco.
- `src/__tests__/globalSetup.ts` confere, antes da suíte, as variáveis,
  se o banco é local (ou é o CI), se ele responde e se as migrações
  estão aplicadas. Local: `docker-compose.test.yml` + `.env.test` (ver o
  README, seção "Testes").
- Corridas entre requisições são testadas com uma barreira
  (`src/__tests__/helpers/barrier.ts`) que segura as duas num ponto exato
  do caso de uso, então o resultado não depende de timing
  (`concurrency.test.ts`).
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
