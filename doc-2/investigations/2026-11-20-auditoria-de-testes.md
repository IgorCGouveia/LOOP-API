# Investigação: auditoria da suíte de testes

- **Data:** 2026-11-20
- **Conferido nos commits:** `b8700bb` (main) e `22699ae` (PR #26, base desta mudança)
- **Estratégia resultante:** [testing-strategy.md](../architecture/testing-strategy.md)
- **Decisão pendente:** [ADR-0008](../adr/0008-sessao-de-usuario-apagado.md) (Proposto)

## Resumo

A suíte estava verde, mas os testes cobriam bem o caminho feliz e deixavam
de fora casos de borda de autenticação, erros que o Fastify gera antes do
handler e as rotas aninhadas de check-in. A auditoria mediu a cobertura,
leu cada arquivo de teste contra o código e reproduziu cada suspeita com
um teste descartável antes de registrar aqui.

Achados: seis bugs confirmados. Quatro foram corrigidos nesta mudança,
um já estava corrigido na PR #26 e um depende de decisão (ADR-0008).

## Cobertura medida

| Momento | Testes | Linhas | Branches |
|---|---|---|---|
| `main` (`b8700bb`) | 82 | 80,7% | 71,6% |
| PR #26 (`22699ae`) | 115 | 85,4% | 82,1% |
| Depois desta mudança | 235 (+2 `todo`) | 96,6% | 88,9% |

O último número exclui da conta os três pontos de entrada de CLI em
`src/scripts/` (ver [testing-strategy.md](../architecture/testing-strategy.md#cobertura)).
Sem a exclusão, ficam 89,4% e 86,3%.

Os maiores buracos em `b8700bb` eram `CheckinController.ts` (20% das
linhas) e `checkinServices.ts` (45%): nenhuma regra de permissão das
rotas de check-in tinha teste.

## Bugs confirmados

### 1. Todo P2002 virava "Email já cadastrado."

- **Onde:** `src/Middleware/errorHandler.ts` em `b8700bb`.
- **Reprodução:** dois `DELETE /habits/:id/checkin` em paralelo. Um
  responde `409 {"error":"Email já cadastrado."}`, que é o unique
  `HabitLog.undoesId`, sem relação com email.
- **Status:** já corrigido na PR #26 (issue #18, commit `f6129dd`).
  Coberto por `conflicts.test.ts` e `concurrency.test.ts`.

### 2. O rate limit respondia 500 em vez de 429

- **Onde:** `src/Middleware/rateLimit.ts:18` com `errorHandler.ts` (em `22699ae`, linha 55).
- **Causa:** o `@fastify/rate-limit` 11 lança o objeto devolvido pelo
  `errorResponseBuilder` como erro. Com `setErrorHandler` customizado,
  esse objeto chega ao `errorHandler`, que não reconhece o tipo e cai no
  `500`. O `429` documentado em `docs/API-REFERENCE.md` nunca chegava ao
  cliente. Além disso, cada bloqueio gerava um log de nível `error`.
- **Reprodução:** 21 `POST /login` seguidos do mesmo IP. O 21º responde
  `500 Internal Server Error`.
- **Correção:** `errorHandler.ts:71` reconhece erro com `statusCode` 429 e
  devolve o corpo de `buildRateLimitError`. O header `Retry-After` que o
  plugin já tinha posto continua na resposta.
- **Teste:** `rateLimit.test.ts`.

### 3. Erros 4xx do Fastify viravam 500

- **Onde:** o mesmo ponto do bug 2.
- **Reprodução:** em qualquer rota com corpo:
  - JSON malformado → `500` (devia ser `400`);
  - `Content-Type: text/xml` → `500` (devia ser `415`);
  - corpo acima de 1 MiB → `500` (devia ser `413`).
- **Correção:** `errorHandler.ts:34` trata qualquer erro com `statusCode`
  entre 400 e 499 e responde com mensagem fixa por status, sem repassar a
  mensagem interna do parser.
- **Teste:** `clientErrors.test.ts`.

### 4. Token sem `id` no payload causava 500

- **Onde:** `src/Middleware/Auth.ts`, linha 47 em `22699ae`.
- **Causa:** o middleware aceitava qualquer payload com assinatura válida.
  `req.user.id` ficava `undefined` e o Prisma lançava erro no service.
- **Risco real:** baixo, porque só quem tem a `SECRET_KEY` assina token.
  Mas um token antigo com outro formato, depois de uma mudança no payload,
  derrubaria a rota com `500`.
- **Correção:** `Auth.ts:17` valida o payload com Zod (`id` não vazio,
  `role` em `USER | ADMIN`). Fora do formato → `401`.
- **Teste:** `authEdgeCases.test.ts`.

### 5. O esquema do header Authorization era ignorado

- **Onde:** `Auth.ts`, linha 30 em `22699ae` (`bearer.split(" ")[1]`).
- **Reprodução:** `Authorization: Basic <jwt válido>` → `200`.
- **Risco real:** baixo. Não abre acesso sem um token válido, mas aceita
  um formato que a [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750) não
  prevê e esconde bug de cliente.
- **Correção:** `Auth.ts:40` exige o esquema `Bearer` (sem diferença de
  caixa) e exatamente um token. Na mesma mudança, `jwt.verify` passou a
  aceitar só `HS256` (`Auth.ts:24`), o algoritmo que `signAccessToken` usa.
  Isso não corrige um bug: a lib já recusa `alg: none` quando recebe um
  segredo. A lista fixa impede que um token escolha outro algoritmo HMAC.
- **Teste:** `authEdgeCases.test.ts`.

### 6. Token de usuário apagado

- **Onde:** `src/services/habitServices.ts:36-40` e
  `src/controllers/HabitController.ts:27-29`.
- **Reprodução:** criar um usuário, apagar a conta e usar o `accessToken`
  dele, que continua válido por até 1h:
  - `POST /habits` → `500` (violação de FK ao gravar o hábito);
  - `GET /me/habits` → `200 { "data": null }`.
- **Status:** aberto. A correção muda o contrato e tem trade-off de
  desempenho, então virou o [ADR-0008](../adr/0008-sessao-de-usuario-apagado.md).
  Os testes esperados estão como `it.todo` em `deletedUserSession.test.ts`.

## Outros achados

### Cadastro com timezone `UTC` era recusado

`Intl.supportedValuesOf('timeZone')` devolve os nomes canônicos por região
e não inclui `"UTC"`. O `Intl` aceita `"UTC"`, e esse é o default da
coluna `User.timezone` (`prisma/schema.prisma:17`), mas o `POST /users`
recusava com `400`. Corrigido em `src/schema/userVal.ts:7`, com teste em
`schemas.test.ts`.

### `z.cuid2()` é permissivo

O validador de `userId` em `CreateHabitVal` aceita qualquer sequência de
letras minúsculas e dígitos (`"123"` passa). Não é um bug: o `userId` vem
do token, não do corpo. Só não dá para tratar o validador como prova de
que o id existe.

### Testes que escondiam bugs

- **Admin com id inventado.** `gaps.test.ts` e `ownership.test.ts`
  assinavam um token `{ id: "admin-gaps-test", role: "ADMIN" }` sem
  usuário no banco. Se esse admin chamasse `POST /habits`, receberia o
  `500` do bug 6. Os dois arquivos passaram a usar `createAdmin()`
  (`src/__tests__/helpers/factories.ts`), que grava um admin de verdade.
- **Ordem entre testes.** `ownership.test.ts` apaga `otherId` no meio do
  arquivo, e os testes seguintes dependem disso. Rodar um teste isolado
  (`-t`) pode dar resultado diferente da suíte inteira. Fica como dívida
  (ver [testing-strategy.md](../architecture/testing-strategy.md#dívida-conhecida)).

### Sessões continuam valendo depois de trocar a senha

`PATCH /users/:id` com senha nova não revoga os refresh tokens nem
invalida o `accessToken` atual. `ownership.test.ts` registra isso num
comentário. É uma decisão de produto, sem ADR ainda. O ADR-0008 trata só
o caso de conta apagada.
