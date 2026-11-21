# ADR-0015: Limites de uso e paginação nas rotas autenticadas

- **Status:** Proposto
- **Data:** 2026-11-20
- **Decisor:** dono do projeto
- **Relacionado:** [auditoria de segurança, achado M6](../investigations/auditoria-seguranca-2026-11-20.md#m6-rotas-autenticadas-sem-limite-de-uso-nem-paginação),
  [ADR-0013](./0013-como-a-api-descobre-o-ip-do-cliente.md),
  [ADR-0017](./0017-paginacao.md)

> **Decidir junto com o [ADR-0017](./0017-paginacao.md) (paginação).** A
> parte de paginação deste ADR (opção B, paginação por cursor) se sobrepõe
> ao ADR-0017, que veio da revisão de design. Os dois foram escritos em
> paralelo e precisam ser decididos juntos, para não aceitar duas regras de
> paginação diferentes.

## Contexto

O rate limit está registrado com `global: false`
(`src/Middleware/rateLimit.ts:15-19`) e só duas rotas usam: `POST /login`
e `POST /users`. Depois do login, nada limita:
- quantos hábitos uma conta cria (`POST /habits`,
  `src/routes/HabitRoute.ts:13`);
- quantos check-ins e undos ela faz (`src/routes/CheckinRoute.ts:11-13`).
  Cada check-in grava um `HabitLog`, e o undo grava outro
  (`src/repositories/checkinRepository.ts:26-34`, conferido em `e49d0ef`).

As listagens devolvem tudo numa resposta:
- `GET /habits` (admin) e `GET /users/:userId/habits`
  (`src/services/habitServices.ts:64-88`);
- `GET /users` (admin, `src/services/userServices.ts:39-45`);
- `GET /habits/:habitId/checkins` e `GET /users/:userId/checkins`
  (`src/repositories/checkinRepository.ts:46-58`). Estas crescem um item
  por dia por hábito, para sempre.

Hoje o volume é pequeno e o cadastro é limitado por IP. Mas esse limite
cai com o achado H1 (ver ADR-0013).

## Opções consideradas

### Opção A: rate limit por usuário nas rotas de escrita
- Como funciona: `config.rateLimit` nas rotas de escrita de hábito e
  check-in, com `keyGenerator: (req) => req.user.id`. O hook do rate
  limit precisa rodar depois da auth para enxergar `req.user`.
- Muda no contrato da API: as rotas podem responder 429 (depende do
  achado M1 para o 429 não sair como 500).
- Precisa de migração: não.
- Ganha: freia abuso sem mudar o formato das respostas.
- Perde: não resolve listagens que ficam grandes com o uso normal.

### Opção B: paginação por cursor nas listagens
- Como funciona: `?cursor=<id>&limit=<n>` com `limit` limitado (ex.: 100),
  e a resposta ganha `nextCursor`.
- Muda no contrato da API: sim. O `data` passa a ser uma página, e o
  `loop-web` precisa seguir o cursor.
- Precisa de migração: não. Pode precisar de índice novo, conforme a
  ordenação.
- Ganha: o tamanho da resposta fica limitado independentemente do uso.
- Perde: quebra os clientes atuais se não houver período de transição.

### Opção C: teto de hábitos por conta
- Como funciona: `CreateHabit` recusa (409 ou 422) quando a conta já tem
  N hábitos.
- Muda no contrato da API: um erro novo no `POST /habits`.
- Precisa de migração: não.
- Ganha: limita o crescimento na origem, com uma regra simples.
- Perde: é uma regra de produto. O N precisa de justificativa.

### Opção D: adiar, registrando o gatilho
- Como funciona: nada muda agora. Revisitar quando houver usuários reais
  ou uma listagem passar de um tamanho combinado.
- Muda no contrato da API: nada.
- Precisa de migração: não.
- Ganha: zero esforço agora.
- Perde: o risco continua aberto.

As opções A, B e C não se excluem.

## Decisão

<Preencher quando o status for Aceito.>

## Consequências

- Qualquer limite novo precisa de teste do caso negado (429, 409 ou 422)
  e de atualização no `docs/API-REFERENCE.md`.
- A opção A depende do achado M1 (o 429 hoje sai como 500) e do ADR-0013
  (só para os limites por IP; o limite por usuário não depende dele).
