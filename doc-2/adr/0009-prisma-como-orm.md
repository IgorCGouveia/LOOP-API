# ADR-0009: Prisma como ORM

- **Status:** Aceito (retroativo)
- **Data:** 2026-11-20 (decisão original: 2026-05-20, commit `68cb140`, com `prisma.config.ts` e a primeira migration)
- **Decisor:** dono do projeto
- **Relacionado:** [ADR-0010](./0010-postgresql-como-banco.md), [ADR-0008](./0008-fastify-como-framework-http.md)

> **ADR retroativo.** O raciocínio da época não ficou registrado (ver
> [ADR-0001](./0001-registrar-decisoes-com-adr.md)). Contexto reconstruído
> a partir do código no commit `b8700bb`.

## Contexto

- O `prisma.config.ts` já está no primeiro commit. A primeira migration é
  `20260520171428_tabela_usuario`, do mesmo dia.
- Hoje são 8 migrations em `prisma/migrations/`. Uma delas tem um
  backfill em TypeScript
  (`20260904120000_add_habit_schedule_and_log_events/backfill.ts`).
- O client é gerado em `src/generated/prisma` (`prisma/schema.prisma:3`)
  e o build copia essa pasta para `dist/` (`package.json`, script
  `build`).
- Uma única instância de `PrismaClient` é exportada por `src/app.ts:16` e
  importada pelos services e pelo repository.
- O modelo tem relações com `onDelete: Cascade`, uma auto-relação
  (`HabitLog.undoes`), `@unique` composto, colunas `@db.Date` e um array
  de inteiros (`HabitSchedule.daysOfWeek Int[]`).
- O código não tem nenhuma query em SQL cru. A única transação é a
  interativa de `createScheduleVersion`
  (`src/repositories/checkinRepository.ts:91`).
- O `errorHandler` traduz o erro `P2002` (violação de unique) em `409`
  (`src/Middleware/errorHandler.ts:21`).

## Opções consideradas

| | Prisma | TypeORM | Drizzle | Knex / SQL direto |
|---|---|---|---|---|
| Fonte do schema | `schema.prisma` (DSL própria) | Classes com decorators | TypeScript | Migrations em JS/SQL |
| Tipos das queries | Gerados, inclusive para `select`/`include` | Parciais | Inferidos do schema TS | Manuais |
| Migrations | Geradas pelo diff do schema | Geradas ou manuais | Geradas (`drizzle-kit`) | Manuais |
| Distância do SQL | Alta | Média | Baixa | Nenhuma |
| Peso em runtime | Engine binário separado | Só JS | Só JS | Só JS |

### Opção A: Prisma (escolhida)
- Ganha: o schema é um arquivo só e legível, e é a fonte de verdade do
  modelo. Os tipos de retorno acompanham `include` e `select`. As
  migrations saem do diff do schema. Os erros vêm com código estável
  (`P2002`, `P2025`), o que permite tratar erro de banco num lugar só.
- Perde: engine binário (no projeto, `engine: "classic"` em
  `prisma.config.ts`) que pesa no build e no cold start. Uma DSL a mais
  para aprender. Recursos fora do que a DSL cobre (lock de linha,
  `SELECT ... FOR UPDATE`, alguns índices) exigem SQL cru.

### Opção B: TypeORM
- Ganha: padrão Active Record ou Data Mapper, conhecido de quem vem de
  Java ou C#.
- Perde: tipos fracos nas queries com relações. Histórico de bugs em
  migrations geradas. Decorators acoplam o modelo às classes.

### Opção C: Drizzle
- Ganha: schema em TypeScript puro, queries próximas do SQL, sem engine
  binário. Funciona bem em serverless.
- Perde: em maio de 2026 tinha menos material de estudo e menos exemplos
  de migration com backfill que o Prisma.

### Opção D: Knex ou SQL direto (`pg`)
- Ganha: controle total do SQL, sem camada extra.
- Perde: tipos escritos à mão e sem garantia de que batem com o banco.
  Migrations e mapeamento de relações ficam todos por conta do projeto.

## Decisão

**Prisma**, com o client gerado dentro de `src/` e uma instância única
compartilhada.

O motivo original não ficou registrado. O que o código mostra é um
projeto que usa o schema como documentação do modelo (os comentários
explicando regras de negócio estão no próprio `schema.prisma`) e que
depende dos códigos de erro do Prisma para o `409`.

## Consequências

- **Mais fácil:** mudar o modelo. Editar o `schema.prisma`, gerar a
  migration e os tipos de todo o código se ajustam juntos.
- **Mais fácil:** isolar o acesso ao banco. O
  `src/repositories/checkinRepository.ts` é o único módulo que toca em
  `habitLog`, `graceFill` e `habitSchedule`, e o teste
  `checkinRepositoryBoundary.test.ts` garante isso.
- **Mais difícil:** regras de concorrência. O check-in lê o último log e
  decide o que gravar, e o Prisma não tem `FOR UPDATE` na API. Hoje o que
  segura duplicidade é constraint de banco (`@unique`), não lock, e só
  onde existe constraint (ver [ADR-0010](./0010-postgresql-como-banco.md),
  *Consequências*).
- **Mais difícil:** o build. `prisma generate` precisa rodar antes do
  `tsc`, e a pasta gerada é copiada à mão para `dist/`. Esquecer isso
  quebra o boot em produção.
- **A acompanhar:** a instância única em `src/app.ts` é criada no import
  do módulo. Em processo longo isso é o certo. Em serverless (branch
  `IgorCGouveia/Deploy`, ADR-0005, ainda não integrado) cada instância da
  função abre o próprio pool, e por isso aquele ADR usa a URL com pooler.
- **A acompanhar:** o Prisma 6 tem o engine "classic" como padrão e está
  migrando para um client sem binário. Trocar de engine é uma mudança de
  build e merece ADR próprio quando vier.
