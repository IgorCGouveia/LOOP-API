# Modelo de domínio e invariantes

> Conferido no commit `4fc2b5a`. Schema: `prisma/schema.prisma`.

## Entidades

| Entidade | Papel | Observação |
|---|---|---|
| `User` | Dono dos hábitos | `timezone` é obrigatório no cadastro. Nenhuma resposta da API devolve esse campo. |
| `Habit` | Hábito de um usuário | Guarda `longestStreak` e `graceTokens`. |
| `HabitSchedule` | Versão da agenda | Nunca recebe UPDATE no lugar. Editar fecha a versão vigente e abre outra. |
| `HabitLog` | Evento `CHECKIN` ou `UNDO` | Só cresce, nada é apagado. `date` é o dia local, `checkedAt` é o instante. |
| `GraceFill` | Dia perdoado por token | Tabela separada para `HabitLog` continuar significando só "fiz check-in". `checkinId` aponta para o `CHECKIN` que gastou o token. |
| `RefreshToken` | Sessão do `loop-web` | Guarda só o hash sha256. |

## Invariantes

Regras que o código pressupõe e que os tipos não garantem. Se uma delas
for quebrada, o cálculo de streak passa a dar resultado errado sem
nenhum erro aparecer.

### I1. Um único referencial de dia por usuário

Todos os dias locais de um usuário (`HabitLog.date`,
`HabitSchedule.effectiveFrom/To`, `GraceFill.date`) precisam ter sido
calculados no mesmo timezone.

**Por que importa:** `targetDaysBetween` e `buildContiguity` comparam
essas datas fazendo conta com elas (`+86_400_000` por dia). Se uma data
foi calculada em Los Angeles e a outra em Tóquio, a diferença entre as
duas deixa de representar quantos dias se passaram para o usuário.

**Como é garantida:** o timezone é fixo a partir do cadastro.
`UpdateUserVal` não aceita `timezone` e rejeita chaves desconhecidas
([ADR-0002](../adr/0002-timezone-do-usuario-apos-cadastro.md), teste em
`src/__tests__/timezoneFrozen.test.ts`). Até a issue #15 ser corrigida,
o PATCH permitia a troca. Ver a
[investigação](../investigations/issue-15-timezone-patch.md).

### I2. Dia fechado não muda de veredito

Um dia local que já passou mantém o veredito que tinha (completo ou
não). Editar a agenda não pode reescrever esse veredito (ver
`isCompleted` e o "selamento" em `checkinRepository.ts`).

**Situação atual:** garantida para edição de agenda (selamento) e para
timezone (I1).

### I3. O log só cresce

`HabitLog` nunca recebe UPDATE nem DELETE de regra de negócio. Desfazer
grava um `UNDO` com `undoesId` único, então não dá para desfazer o mesmo
check-in duas vezes.

`GraceFill` não é evento do usuário, é estado derivado do gasto de um
token. Desfazer o `CHECKIN` que criou um fill apaga esse fill e devolve
o token ([ADR-0010](../adr/0010-desfazer-check-in-devolve-grace-token.md)).
Fills anteriores a `checkinId` (null) não são tocados.

### I4. Posse do recurso vem do banco

A checagem de dono usa o `userId` gravado no banco e nunca um valor
enviado pelo cliente. Por isso nenhum schema de UPDATE pode aceitar
`userId` (corrigido para hábitos no commit `8b1a04a`).

### I5. Cada caso de uso grava tudo ou nada

Criar/editar hábito, check-in e undo gravam numa transação só. Um `500`
significa que nada foi gravado, e repetir não duplica nada
([ADR-0009](../adr/0009-unidade-de-trabalho-por-caso-de-uso.md), teste
em `src/__tests__/transactions.test.ts`). Hábito sem agenda, fill sem
débito do token e `longestStreak` sem o check-in correspondente eram
possíveis antes disso. `npm run audit:integrity` lista o que sobrou no
banco ([roteiro](../guides/backfill-habit-schedule.md)).
