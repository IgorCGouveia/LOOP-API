# ADR-0005: PostgreSQL como banco de dados

- **Status:** Aceito (retroativo)
- **Data:** 2026-11-20 (decisão original: 2026-05-20, primeira migration `20260520171428_tabela_usuario`)
- **Decisor:** dono do projeto
- **Relacionado:** [ADR-0004](./0004-prisma-como-orm.md), [modelo de domínio](../architecture/domain-model.md)

> **ADR retroativo.** O raciocínio da época não ficou registrado (ver
> [ADR-0001](./0001-registrar-decisoes-com-adr.md)). Contexto reconstruído
> a partir do código no commit `b8700bb`.

## Contexto

- `provider = "postgresql"` em `prisma/schema.prisma` e
  `migration_lock.toml` desde a primeira migration.
- O domínio é relacional: `User` 1-N `Habit` 1-N (`HabitSchedule`,
  `HabitLog`, `GraceFill`), com exclusão em cascata a partir do usuário.
- O cálculo de streak depende de dia de calendário separado de instante.
  O schema usa `@db.Date` em `HabitLog.date`, `HabitSchedule.effectiveFrom/To`,
  `GraceFill.date` e `Habit.longestStreakStartDate`, e `timestamp` nos
  instantes (`checkedAt`, `effectiveFromAt`).
- Regras de negócio são garantidas por constraint de banco:
  - `GraceFill @@unique([habitId, date])`: um dia só é perdoado uma vez.
  - `HabitLog.undoesId @unique`: um check-in só é desfeito uma vez.
  - `HabitSchedule @@unique([habitId, effectiveFromAt])`.
- `HabitSchedule.daysOfWeek` é `Int[]`, tipo array nativo.
- A edição de agenda precisa de transação (fecha a versão vigente e abre
  outra, `checkinRepository.ts:91`).
- O CI sobe um Postgres como service e roda as migrations antes dos
  testes (`.github/workflows/ci.yml`). Os testes não usam mock de banco.
- Em produção, o banco é um Postgres gerenciado. Foi o do Render até o
  #27 (`b19483c`), e desde então é o Neon.

## Opções consideradas

| | PostgreSQL | MySQL | SQLite | MongoDB |
|---|---|---|---|---|
| Tipo `date` separado de `timestamp` | Sim | Sim | Não (texto ou número) | Não |
| Array nativo | Sim | Não (JSON) | Não | Sim |
| Transação e constraint `unique` composta | Sim | Sim | Sim | Transação sim, com limites |
| Hospedagem gerenciada grátis | Render, Neon, Supabase | Poucas opções | Não se aplica a servidor | Atlas |
| Suporte no Prisma | Completo | Completo | Completo, sem arrays | Parcial, sem migrations |

### Opção A: PostgreSQL (escolhida)
- Ganha: tipo `date` de verdade, array nativo, transações e constraints
  que seguram as regras do domínio. Muitas opções de hospedagem grátis.
  É o banco mais bem suportado pelo Prisma.
- Perde: um servidor a mais para rodar em dev e no CI, em vez de um
  arquivo.

### Opção B: MySQL
- Ganha: tão maduro quanto o Postgres para este volume de dados.
- Perde: sem array nativo, `daysOfWeek` viraria JSON ou tabela à parte.
  Menos planos gerenciados gratuitos.

### Opção C: SQLite
- Ganha: zero infraestrutura. O banco é um arquivo e os testes ficam
  rápidos.
- Perde: sem `date` nativo nem arrays no Prisma. Não serve para um
  servidor com mais de uma instância. Usar SQLite em teste e outro banco
  em produção faria os testes perderem o valor de "banco real".

### Opção D: MongoDB
- Ganha: documento flexível; o hábito com seus logs poderia ser um
  documento só.
- Perde: as regras do domínio (um perdão por dia, um undo por check-in,
  cascata do usuário) são relacionais e precisariam ser garantidas pelo
  código. O Prisma não gera migrations para MongoDB.

## Decisão

**PostgreSQL**, gerenciado em produção e real (sem mock) nos testes.

O motivo original não ficou registrado. O que o código mostra é que o
modelo depende de três recursos que o Postgres tem e as alternativas não
têm todos juntos: `date` separado de `timestamp`, array nativo e
constraints `unique` compostas.

## Consequências

- **Mais fácil:** garantir regras de negócio no banco em vez de no código.
  Se dois check-ins concorrentes tentarem perdoar o mesmo dia, o segundo
  `GraceFill` viola o unique e não vira dado duplicado. A constraint não
  cobre tudo: o desconto do saldo de tokens
  (`src/services/checkinServices.ts:125-128`) é um `update` separado,
  fora de transação.
- **Mais fácil:** trocar de provedor. Render, Neon e qualquer outro
  Postgres gerenciado servem sem mudar código, só a `DATABASE_URL`.
- **Mais difícil:** rodar o projeto localmente exige um Postgres
  (`README.md`, *Running locally*). Os testes também.
- **Mais difícil:** o tipo `date` volta para o Node como `Date` à
  meia-noite UTC. Todo o código de dia local depende de tratar esse valor
  como "dia" e nunca como instante (invariante I1 no
  [modelo de domínio](../architecture/domain-model.md)).
- **A acompanhar:** os planos grátis têm limite de conexões. Em
  serverless isso obriga a usar pooler. Em produção a app usa a URL com
  pooler do Neon e a migration usa a direta (`scripts/vercel-migrate.mjs`).
