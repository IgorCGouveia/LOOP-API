# ADR-0012: Desenho das rotas de usuários, hábitos e check-ins

- **Status:** Aceito (retroativo)
- **Data:** 2026-11-20 (decisões originais: `GET /users/:userId/habits` em 2026-06-14, commit `3374974`; `/me/habits` e a regra dono/admin em 2026-07-03, `43a1351`; check-ins em 2026-08-26, `97056cd`; `PUT` trocado por `PATCH` em 2026-09-04, `6115d70`)
- **Decisor:** dono do projeto
- **Relacionado:** [ADR-0011](./0011-autenticacao-jwt-e-refresh-em-cookie.md), [ADR-0002](./0002-timezone-do-usuario-apos-cadastro.md)

> **ADR retroativo.** Contexto reconstruído a partir do código no commit
> `b8700bb`. O pedido de documentação falava em "rotas aninhadas
> (usuários → hábitos)". O código mostra um desenho **misto**: o
> aninhamento existe só nas listagens por usuário. Este ADR registra o
> desenho como ele é.

## Contexto

Hierarquia do domínio: `User` 1-N `Habit` 1-N `HabitLog` (check-ins).
Todo hábito tem um único dono e nunca muda de dono.

Rotas atuais (`src/routes/*.ts`):

| Rota | Forma | Quem pode |
|---|---|---|
| `GET /users/:userId/habits` | aninhada em usuário | dono ou admin |
| `GET /users/:userId/checkins` | aninhada em usuário | dono ou admin |
| `GET /me/habits` | atalho para o próprio usuário | qualquer logado |
| `POST /habits` | plana; o dono vem do token | qualquer logado |
| `GET /habits` | plana | admin |
| `PATCH /habits/:id`, `DELETE /habits/:id` | plana | só o dono |
| `POST /habits/:habitId/checkin` | aninhada em hábito | dono ou admin |
| `DELETE /habits/:habitId/checkin` | aninhada em hábito | dono ou admin |
| `GET /habits/:habitId/checkins` | aninhada em hábito | dono ou admin |

Como a posse é conferida:
- Nas rotas por usuário, o controller compara `:userId` com `req.user.id`
  antes de ir ao banco (`src/controllers/HabitController.ts:36`,
  `src/controllers/CheckinController.ts:75`).
- Nas rotas por hábito, o controller busca o hábito e compara
  `habit.userId` com `req.user.id` (`HabitController.ts:64-72`,
  `CheckinController.ts:18`). O dono vem do banco, nunca da URL nem do
  corpo.
- Em `POST /habits`, o `userId` é sempre `req.user.id`
  (`HabitController.ts:11`). O corpo não escolhe o dono.

## Opções consideradas

### Opção A: tudo aninhado sob o usuário
- `/users/:userId/habits/:habitId/checkins`, inclusive para criar,
  editar e apagar.
- Ganha: a URL mostra a hierarquia inteira. Fica fácil escrever um guard
  único que confere `:userId`.
- Perde: o `:userId` é redundante, porque o hábito já sabe quem é o dono.
  Abre o caso "`:userId` não bate com o dono real do `:habitId`", que
  precisa de checagem extra. Se essa checagem for esquecida, o guard
  confere o usuário da URL e não o dono do hábito (IDOR). URLs longas
  para o cliente montar.

### Opção B: tudo plano
- `/habits`, `/habits/:id`, `/checkins?habitId=...`, `/checkins?userId=...`.
- Ganha: cada recurso tem um endereço só. O filtro fica na query string.
- Perde: a relação "check-in pertence a hábito" some da URL. A listagem
  de outro usuário vira filtro por query, mais fácil de esquecer de
  autorizar.

### Opção C: misto, aninhando no máximo um nível (escolhida)
- Coleções de um usuário ficam sob `/users/:userId/...`. O recurso
  hábito tem endereço próprio (`/habits/:id`). Check-in fica sob o hábito
  (`/habits/:habitId/checkin(s)`), porque não existe sem ele. `/me/...`
  é o atalho para o próprio usuário.
- Ganha: cada rota carrega só o id de que precisa. A posse é conferida
  pelo dado do banco. As URLs ficam curtas.
- Perde: dois padrões convivem, e quem lê a lista de rotas precisa
  entender a regra. Há dois jeitos de listar os próprios hábitos
  (`/me/habits` e `/users/<meu id>/habits`).

## Decisão

**Opção C.** Aninhamento de no máximo um nível. Listagens de um usuário
ficam em `/users/:userId/...`. O hábito é um recurso de primeiro nível.
Check-in fica sob o hábito. A posse é sempre resolvida a partir do banco
(`habit.userId`), nunca de um id vindo na URL ou no corpo.

O `README.md` registra o motivo de segurança: *"ownership checks
resolved from the database, not trusted from the request — closes the
classic IDOR hole"*. Os outros motivos (URL curta, sem id redundante)
são inferidos do desenho.

## Consequências

- **Mais fácil:** autorizar. Uma rota de hábito precisa de uma busca e uma
  comparação. Não existe par `userId`/`habitId` para conferir se combina.
- **Mais fácil:** o cliente. Com o id do hábito em mãos, todas as ações
  sobre ele saem dele, sem precisar do id do usuário.
- **Mais difícil:** a regra de admin não é a mesma em todas as rotas de
  hábito. O admin pode fazer e desfazer check-in no hábito de outra
  pessoa (`CheckinController.ts:18`, `:39`), mas não pode editar nem
  apagar esse hábito (`HabitController.ts:72`, `:102`). O `README.md`
  marca os check-ins como "owner", o que diverge do código. Decidir qual
  das duas regras vale é uma decisão à parte.
- **Mais difícil:** a ordem 403/404 muda conforme a forma da rota. Nas
  rotas por usuário, quem não é dono recebe `403` antes de qualquer
  consulta, então não descobre se o usuário existe. Nas rotas por
  hábito, a busca vem antes, então quem não é dono recebe `404` para id
  inexistente e `403` para id existente. Com ids `cuid2` o risco prático
  é baixo, mas é uma diferença de comportamento.
- **Mais difícil:** o mesmo recurso usa nomes de parâmetro diferentes
  (`:id` em `/habits/:id`, `:habitId` em `/habits/:habitId/checkin`).
- **A acompanhar:** `PATCH /users/:id` e `DELETE /users/:id` usam `:id`
  e não `:userId`, e não existe `GET /me`. Se o `/me` virar padrão para
  o próprio usuário, as rotas de usuário merecem revisão junto.
- **A acompanhar:** nenhuma listagem é paginada. Se o volume crescer,
  `GET /users/:userId/checkins` e `GET /habits/:habitId/checkins` são as
  primeiras a precisar. Paginação muda o contrato.
