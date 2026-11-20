# ADR-0005: Admin pode agir nos check-ins de outra pessoa?

- **Status:** Proposto
- **Data:** 2026-11-20
- **Decisor:** dono do projeto
- **Relacionado:** issue #17; commit `2fce409`

## Contexto

Conferido no commit `4fc2b5a`: cada handler repetia "carrega o hábito,
compara o dono, talvez libera ADMIN", e as cópias discordavam:

| Rota | `docs/API-REFERENCE.md` | Código |
|---|---|---|
| `PATCH /habits/:id` | dono | dono |
| `DELETE /habits/:id` | dono | dono |
| `POST /habits/:habitId/checkin` | dono | dono **ou admin** |
| `DELETE /habits/:habitId/checkin` | dono | dono **ou admin** |
| `GET /habits/:habitId/checkins` | dono | dono **ou admin** |
| `GET /users/:userId/checkins` | dono ou admin | dono ou admin |

Nenhum teste cobria admin nas rotas de check-in, então a diferença não
aparecia. Admin podia gravar, desfazer e ler o log de check-in de
qualquer pessoa.

## Opções consideradas

### Opção A: seguir a doc (só o dono nas rotas do hábito)

- Uma função só, `requireHabitAccess(action)`, num preHandler depois de
  `auth.user`, com uma tabela de política por ação.
- Contrato da API: admin passa a receber `403` em
  `POST/DELETE/GET /habits/:habitId/checkin(s)`. Continua vendo os
  check-ins de qualquer um por `GET /users/:userId/checkins`.
- Ganha: código e doc batem; admin não escreve no histórico de outra
  pessoa, o que preserva o significado do log ("o usuário fez").
- Perde: admin não consegue corrigir o check-in de alguém pela API.
  Nenhum cliente documentado faz isso.

### Opção B: seguir o código (admin nas rotas de check-in)

- Mesma função, com `allowAdmin: true` nas três ações de check-in.
- Contrato da API: não muda; a doc é que muda.
- Ganha: admin pode dar suporte direto.
- Perde: um admin consegue fabricar ou apagar streak de outra pessoa sem
  rastro de quem fez.

## Recomendação (implementada neste PR)

Opção A, porque é o contrato já publicado. Mudar de ideia custa uma
linha: `allowAdmin` vira `true` nas ações desejadas em
`src/Middleware/habitAccess.ts`, e a doc é atualizada junto.

## Decisão

<Preencher quando o status for Aceito.>

## Consequências

- A regra mora num lugar só (`src/Middleware/habitAccess.ts`). Os
  controllers recebem o hábito já carregado em `req.habit`, e a leitura
  dupla controller + service sumiu.
- `src/__tests__/ownership.test.ts` cobre admin nas três rotas de
  check-in, o `PATCH` de hábito por admin e o `GET /users/:userId/checkins`.
