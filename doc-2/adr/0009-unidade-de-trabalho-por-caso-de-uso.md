# ADR-0009: Como garantir que cada caso de uso grave tudo ou nada?

- **Status:** Proposto
- **Data:** 2026-11-20
- **Decisor:** dono do projeto
- **Relacionado:** issues #16, #19, #20, #18; commit `d260fa6`

## Contexto

Conferido no commit `4fc2b5a`, antes da mudança:

- `CreateHabit` gravava o `Habit` e depois abria outra transação para a
  1ª versão de `HabitSchedule` (`src/services/habitServices.ts:47`,
  `:58`). Uma falha entre os dois deixava um hábito sem agenda, que nunca
  pontua streak.
- `CreateCheckIn` fazia até cinco commits separados: reposição de token,
  `GraceFill`, débito do token, o `CHECKIN` e o `longestStreak`
  (`src/services/checkinServices.ts:118-147`). `UndoCheckIn` fazia dois.
  Um `500` podia chegar com o check-in já gravado, e o cliente que
  repetia criava um `CHECKIN` duplicado (o log aceita vários por dia).
- As funções do `checkinRepository` usavam o client global e não tinham
  como entrar na transação de outra pessoa.
- Duas requisições paralelas no mesmo hábito liam o mesmo log, achavam o
  mesmo dia pulado e uma delas batia no unique de `GraceFill` (#18).

Restrições: não mudar o contrato HTTP e manter o teste de fronteira do
repositório.

## Opções consideradas

### Opção A: transação interativa no service, repositório aceita `tx`, trava na linha do hábito

- As funções do repositório recebem `db: Prisma.TransactionClient` no
  último parâmetro (padrão: o client global).
- Cada caso de uso roda em `prisma.$transaction(async (tx) => ...)`.
- Check-in e undo começam com `SELECT ... FOR UPDATE` na linha do
  `Habit` e fazem as leituras (log, agenda, saldo) dentro da transação.
- Contrato da API: não muda. Um `500` passa a significar "nada gravado".
- Migração: nenhuma.
- Ganha: atomicidade de verdade; check-ins paralelos no mesmo hábito
  ficam em fila, então o token é gasto uma vez só.
- Perde: a transação segura uma conexão do pool durante o cálculo de
  streak, que lê o log inteiro. Check-ins do mesmo hábito esperam um pelo
  outro (hábitos diferentes não).

### Opção B: transação interativa sem trava (leituras fora ou dentro, isolamento padrão)

- Igual à A, sem o `FOR UPDATE`.
- Ganha: nenhuma espera entre requisições.
- Perde: com `READ COMMITTED`, duas transações paralelas ainda calculam
  em cima do mesmo estado. A colisão no `GraceFill` continua possível e
  vira `409` para o cliente repetir.

### Opção C: isolamento `SERIALIZABLE`

- Ganha: o banco detecta qualquer conflito de leitura e escrita.
- Perde: os conflitos voltam como erro de serialização (`P2034`), e
  precisaria de retry no service. É mais caro e mais difícil de testar
  do que uma trava explícita numa linha.

## Recomendação (implementada neste PR)

Opção A. A trava fica numa linha só (o hábito), dura o tempo de um
check-in, e resolve a corrida do #18 sem retry. O teste de fronteira
passou a pegar também `tx.` e `db.` fora do repositório, para o
parâmetro novo não virar atalho.

Para escolher B: tirar as chamadas a `checkinRepository.lockHabit`. Para
escolher C: trocar a trava por `{ isolationLevel: 'Serializable' }` e
adicionar retry em `P2034`.

## Decisão

<Preencher quando o status for Aceito.>

## Consequências

- `src/__tests__/transactions.test.ts` injeta uma falha no meio de cada
  caso de uso e confere que nada ficou gravado. `conflicts.test.ts`
  dispara dois check-ins paralelos.
- Ficar de olho no tamanho do pool de conexões no Render: cada check-in
  segura uma conexão até terminar.
- Dados gravados antes disso podem ter sobras de escritas parciais.
  `npm run audit:integrity` lista o que existe (ver o
  [roteiro](../guides/backfill-habit-schedule.md)).
