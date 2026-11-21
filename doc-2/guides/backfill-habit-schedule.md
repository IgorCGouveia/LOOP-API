# Roteiro: backfill de agenda e auditoria de dados

Passos manuais de banco que o deploy **não** roda sozinho. O `npm start`
só executa `prisma migrate deploy`. Scripts `.ts` dentro de
`prisma/migrations/` nunca são executados pelo Prisma.

Todos os comandos usam o `DATABASE_URL` do ambiente. Rode primeiro num
banco de teste ou numa cópia, nunca direto em produção sem conferir a
saída do modo só leitura.

## 1. Auditoria (só leitura)

```bash
npm run audit:integrity
```

Lista três tipos de sobra de escritas parciais de antes das issues #16,
#19 e #21:

| Saída | O que é | Correção |
|---|---|---|
| `Hábitos sem HabitSchedule` | Hábito criado sem a 1ª versão da agenda. Nunca pontua streak. | Passo 2 |
| `grace fill órfão` | Dia perdoado sem nenhum dia completo depois dele (check-in desfeito ou que falhou depois do fill). | Decisão à parte, ver [ADR-0010](../adr/0010-desfazer-check-in-devolve-grace-token.md) |
| `longestStreak inflado` | Recorde gravado acima do que o log sustenta. | Decisão à parte |

Não grava nada.

## 2. Backfill de agenda para hábitos legados

Hábitos criados antes de 2026-09-04 (migração
`20260904120000_add_habit_schedule_and_log_events`) não têm
`HabitSchedule`.

```bash
npm run backfill:schedules
```

Cria uma versão `DAILY`/`targetPerDay: 1` para cada hábito sem agenda.
O `effectiveFrom` é o **dia local do dono** no `createdAt` (issue #23),
o mesmo critério de `CreateHabit`, e o `effectiveFromAt` é o próprio
`createdAt`. É idempotente: rodar de novo não cria nada.

O comando antigo (`npx tsx prisma/migrations/20260904120000_add_habit_schedule_and_log_events/backfill.ts`)
continua funcionando e chama o mesmo script.

## 3. Se o backfill antigo já rodou em produção

A versão anterior do backfill usava o dia **UTC** do `createdAt`. Para
quem está a oeste de UTC e criou o hábito à noite, a agenda começa um dia
depois do primeiro check-in, e esse dia nunca conta.

**Ainda não se sabe se o backfill antigo rodou em produção.** Para
conferir:

```bash
npm run fix:backfill-effective-from
```

Sem `--apply` o script só lista, uma linha por versão, o valor antigo e
o novo:

```
schedule=... habit=... tz=America/Sao_Paulo effectiveFrom 2026-08-01 -> 2026-07-31
1 versão(ões) a corrigir.
Dry-run: nada foi gravado. Rode com --apply para gravar.
```

- `0 versão(ões)`: o backfill antigo não rodou, ou não afetou ninguém.
  Nada a fazer.
- Mais que zero: guarde a saída (é o registro para desfazer à mão) e
  aplique:

```bash
npm run fix:backfill-effective-from -- --apply
```

Como funciona: só olha a 1ª versão de cada hábito cujo `effectiveFromAt`
é igual ao `createdAt` (a assinatura de uma linha de backfill; as
versões criadas pela API têm um instante um pouco depois). Só move o
`effectiveFrom` para trás, então só pode acrescentar dias completos,
nunca tirar. Grava tudo numa transação e é idempotente.

Depois de rodar, anote aqui a data e o resultado:

| Ambiente | Data | Script | Resultado |
|---|---|---|---|
| produção | — | — | ainda não conferido |
