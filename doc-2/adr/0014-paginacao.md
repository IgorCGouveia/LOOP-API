# ADR-0014: Como paginar as listagens?

- **Status:** Proposto
- **Data:** 2026-11-20
- **Decisor:** dono do projeto
- **Relacionado:** [revisão de design](../proposals/design-review-2026-11-20.md#42-problemas), ADR-0013

## Contexto

Nenhuma listagem é paginada (conferido em `e49d0ef`). As que crescem
sem limite:

| Rota | Cresce com | Ordem atual |
|---|---|---|
| `GET /habits/:habitId/checkins` | todo o histórico do hábito | `date desc` (`checkinRepository.ts:46-51`) |
| `GET /users/:userId/checkins` | histórico de todos os hábitos do usuário | `date desc` |
| `GET /habits` (admin) | todos os hábitos do sistema | `name asc` |
| `GET /users` (admin) | todos os usuários | `id asc` |
| `GET /me/habits` | hábitos do usuário (dezenas, no máximo) | `name asc` |

Fatos que pesam:

- `HabitLog` só recebe inserts (I3), sempre com `date` e `checkedAt`
  crescendo. Uma página que já foi lida não muda, exceto por um UNDO,
  que esconde um item.
- A tela típica do app mostra um mês (calendário) ou "os últimos N".
- `date` não é único (vários check-ins no mesmo dia com
  `targetPerDay > 1`). O cursor precisa de um desempate (`id`).

## Opções consideradas

### Opção A: offset (`?limit=20&offset=40`)
- Resposta: `{ data, page: { limit, offset, total } }`
- Muda no contrato: adiciona query params. Sem eles, devolve a primeira página (ou tudo, durante a transição).
- Precisa de migração: não.
- Ganha: simples, permite "ir para a página 7", e o `total` dá a contagem para a UI.
- Perde: `OFFSET` alto lê e descarta linhas (fica lento no histórico longo). Um insert entre duas páginas duplica ou pula itens. `total` custa um `COUNT(*)` por requisição.

### Opção B: cursor keyset (`?limit=20&cursor=<opaco>`)
- O cursor é `(date, id)` do último item, em base64. A query vira `WHERE (date, id) < ($1, $2) ORDER BY date DESC, id DESC LIMIT 21`.
- Resposta: `{ data, page: { nextCursor | null } }`
- Muda no contrato: adiciona query params. O cliente não pode pular para uma página arbitrária.
- Precisa de migração: índice `(habitId, date DESC, id DESC)` para rodar sem sort.
- Ganha: custo constante em qualquer profundidade, estável com inserts, combina com scroll infinito.
- Perde: sem `total` e sem "página N". Um pouco mais de código.

### Opção C: janela de datas (`?from=2026-11-01&to=2026-11-30`) sem paginação
- Muda no contrato: adiciona `from`/`to` e obriga um teto (ex.: 366 dias).
- Ganha: casa com a tela de calendário. Uma requisição por mês.
- Perde: não serve para as listagens de admin, nem para "últimos N".

### Opção D: combinação (C para check-ins, B para admin)
- Ganha: cada tela usa o modelo que combina com ela.
- Perde: dois mecanismos para manter e documentar.

## Decisão

<Pendente.>

## Consequências

<Preencher quando aceito.> Em qualquer opção, a listagem precisa de um
`limit` máximo (ex.: 100) aplicado pelo servidor, para que um cliente
não peça o histórico inteiro de uma vez.
