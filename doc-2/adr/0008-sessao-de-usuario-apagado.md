# ADR-0008: O que um accessToken de conta apagada pode fazer?

- **Status:** Proposto
- **Data:** 2026-11-21
- **Decisor:** dono do projeto
- **Relacionado:** [auditoria de testes, bug 6](../investigations/2026-11-20-auditoria-de-testes.md#6-token-de-usuário-apagado); `src/__tests__/deletedUserSession.test.ts`

## Contexto

Conferido no commit `22699ae`.

- O `accessToken` é um JWT stateless com validade de 1h
  (`src/services/indexService.ts:22`). `Auth.user` confere a assinatura e
  o formato do payload, mas não consulta o banco (`src/Middleware/Auth.ts`).
- Apagar a conta (`DELETE /users/:id`) remove em cascade os hábitos, os
  logs e os refresh tokens (`prisma/schema.prisma`). O `/refresh` para de
  funcionar na hora. Isso já tem teste.
- O `accessToken` já emitido continua passando no middleware até expirar.
  Cada rota reage de um jeito:

| Rota | Hoje |
|---|---|
| `POST /habits` | `500`: o hábito é gravado com `userId` inexistente e o Postgres recusa a FK (`habitServices.ts:36-40` ignora o `null` de `ensureUserExists`) |
| `GET /me/habits` | `200 { "data": null }` (`HabitController.ts:27-29` não trata o `null`) |
| `GET /users/:userId/habits` (o próprio id) | `404` |
| `GET /users/:userId/checkins` (o próprio id) | `404` |
| `PATCH` / `DELETE /users/:id` (o próprio id) | `404` |
| Rotas de hábito e check-in com id de hábito | `404`: o hábito sumiu no cascade |

- O mesmo vale para `role`. Um admin rebaixado no banco continua admin
  até o token expirar, porque `role` também vem só do token. Hoje não
  existe endpoint que mude `role`, então isso só acontece por edição
  manual no banco.

Restrições:
- `POST /habits` não pode continuar respondendo `500` para uma situação
  prevista. Isso vale para qualquer opção.
- A API ainda não tem usuários reais. A janela máxima do problema é de
  1h por token.

## Opções consideradas

### Opção A: o middleware confere no banco se o usuário existe

**Como funciona**
- `Auth.user` faz `prisma.user.findUnique({ where: { id }, select: { id, role } })`
  depois de validar o JWT. Usuário inexistente → `401 "Token inválido ou expirado."`.
- O `role` passa a vir do banco, não do token.

**Contrato:** toda rota protegida pode responder `401` para conta apagada.
O cliente já trata `401` mandando de volta para o login.

**Migração:** nenhuma.

**Ganha**
- Resolve todas as rotas de uma vez, inclusive as que ainda não existem.
- Corrige também o `role` desatualizado.
- Fecha o caminho para invalidar sessões em outros casos (ex.: conta
  bloqueada) sem mudar o formato do token.

**Perde**
- Uma consulta a mais em toda requisição autenticada (por chave primária,
  então barata, mas em toda requisição).
- O JWT deixa de ser stateless na prática, e a validade de 1h perde parte
  do sentido.

### Opção B: cada service trata o usuário inexistente

**Como funciona**
- `CreateHabit` devolve `null` quando `ensureUserExists` não acha o
  usuário, e o controller responde `404 "Usuário não encontrado."`.
- `GetMyHabits` responde `404` quando o service devolve `null`.
- Um teste por rota garante que nenhuma responde `500` nem `200` com
  `data: null` para conta apagada.

**Contrato:** `POST /habits` e `GET /me/habits` ganham um `404`
documentado. As outras rotas já respondem `404` hoje.

**Migração:** nenhuma.

**Ganha**
- Nenhuma consulta a mais nas rotas que não precisam do usuário.
- A mudança é pequena e local.

**Perde**
- Cada rota nova precisa lembrar desse caso. A proteção depende de teste,
  não de estrutura.
- O `role` desatualizado continua sem solução.
- `404` para "o seu próprio usuário não existe" é menos claro para o
  cliente que `401`.

### Opção C: lista de tokens revogados

**Como funciona**
- O payload do token ganha um `jti`. Apagar a conta, trocar a senha ou
  fazer logout grava os `jti` ativos numa tabela (ou num cache) de
  revogados até a expiração.
- `Auth.user` consulta essa lista.

**Contrato:** igual à opção A (`401`).

**Migração:** sim. Tabela nova, mais um job ou TTL para limpar as
entradas expiradas.

**Ganha**
- Resolve também a troca de senha e o logout de verdade, que hoje não
  invalidam o `accessToken`.

**Perde**
- É a opção mais complexa: tabela nova, limpeza periódica e uma consulta
  por requisição, igual à A.
- No deploy serverless (PR #25), um cache em memória não serve, porque
  cada instância teria a sua lista. Teria de ser banco ou um serviço
  externo.

## Decisão

<Preencher quando o status for Aceito.>

## Consequências

<Preencher quando o status for Aceito.>

Para quem implementar: os dois `it.todo` em
`src/__tests__/deletedUserSession.test.ts` viram testes, com o status
escolhido (`401` em A e C, `404` em B).
