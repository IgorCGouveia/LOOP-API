# ADR-0010: O que acontece com o grace fill quando o check-in que o criou é desfeito?

- **Status:** Aceito (opção A)
- **Data:** 2026-11-20
- **Decisor:** dono do projeto
- **Relacionado:** issue #21, [ADR-0009](./0009-unidade-de-trabalho-por-caso-de-uso.md), invariante [I3](../architecture/domain-model.md#i3-o-log-só-cresce); commit `b4e1b60`

## Contexto

Conferido no commit `4fc2b5a`: quando um check-in cobre um gap de 1
dia-alvo, `CreateCheckIn` grava um `GraceFill` para o dia pulado e
debita 1 token. `UndoCheckIn` só gravava o `UNDO`. O fill e o débito
ficavam.

Exemplo (hábito diário): check-in na segunda; na quarta, check-in que
gasta o token e perdoa a terça; undo na quarta; check-in na quinta. O
fill da terça continua no log efetivo, então a quinta enxerga só um dia
pulado (quarta) e gasta um 2º token. Resultado: um gap de 2 dias-alvo
contado como streak contínua, que o código diz que nunca pode acontecer.
O usuário também perde um token por um check-in que desfez.

Nada ligava o fill ao check-in que o criou, então o undo não tinha como
saber o que compensar.

## Opções consideradas

### Opção A: ligar o fill ao CHECKIN e apagar o fill no undo

- `GraceFill.checkinId` (nulo, único, FK para `HabitLog`).
- `CreateCheckIn` grava o `CHECKIN` primeiro e o fill apontando para ele.
- `UndoCheckIn`, na mesma transação do `UNDO`, apaga o fill ligado e
  devolve o token (teto de 3).
- Contrato da API: o formato não muda; mudam os valores de
  `graceTokens`/`currentStreak` depois de um undo.
- Migração: uma coluna nula + índice único + FK. Só aditiva.
- Ganha: simples; o log de eventos (`HabitLog`) continua só crescendo. O
  que sai é o fill, que é estado derivado do gasto do token e não um
  evento do usuário. O histórico do que o usuário fez continua inteiro
  (`CHECKIN` + `UNDO`).
- Perde: não fica registro de que um fill existiu e foi revertido.

### Opção B: ligar o fill ao CHECKIN e marcar o fill como revertido

- Igual à A, mas com `GraceFill.revokedAt` em vez de apagar. O log
  efetivo ignora fills revertidos.
- Ganha: guarda o histórico do fill.
- Perde: o unique `(habitId, date)` impede um fill novo no mesmo dia
  depois de um revertido (undo na quarta, novo check-in na quarta). Seria
  preciso reaproveitar a linha revertida ou trocar o unique por um índice
  parcial, que o schema do Prisma não expressa (fica só no SQL da
  migração e vira drift).

### Opção C: não compensar

- Ganha: nenhuma mudança.
- Perde: o bug do exemplo continua.

## Recomendação

Opção A. O espírito do "só cresce" (I3) é sobre os eventos do usuário,
e eles continuam intactos. A opção B paga uma complicação de unique só
para guardar um registro que hoje ninguém lê.

Fills gravados antes da coluna existir ficam com `checkinId` null e não
são compensados, então nenhuma streak histórica muda. Para voltar atrás:
reverter o commit e dropar a coluna (nenhum check-in se perde; tokens já
devolvidos não são debitados de novo).

## Decisão

Opção A, aceita pelo dono do projeto em 2026-11-21.

O `GraceFill` guarda o `checkinId` do CHECKIN que o criou. Desfazer esse
CHECKIN apaga o fill e devolve o token, respeitando o teto de 3. Fills
gravados antes da coluna existir ficam com `checkinId` null e não são
compensados.

## Consequências

- `src/__tests__/graceFillUndo.test.ts` cobre o exemplo acima, o undo
  sem token, o fill antigo sem vínculo e o teto de 3.
- Fills órfãos que já existem no banco (de antes desta mudança) aparecem
  em `npm run audit:integrity`. Corrigir esses dados é uma decisão à
  parte.
