# Estratégia de testes

Como o LOOP API é testado, o que cada tipo de teste cobre e as regras
para escrever um teste novo. Para rodar a suíte localmente, veja o
README da raiz, seção "Testes".

- **Conferido no commit:** `22699ae` + mudanças da auditoria de 2026-11-20
- **Origem:** [auditoria de testes](../investigations/2026-11-20-auditoria-de-testes.md)

## Princípios

1. **Prioridade pelo risco.** O que mais importa testar é o que corrompe
   dado ou abre acesso: autorização, autenticação, streak e grace token,
   e o "dia local". Getter, rota trivial e código do framework ficam de fora.
2. **Banco de verdade, sem mock.** Os testes de integração rodam contra
   um Postgres descartável (`docker-compose.test.yml`). Mock do Prisma
   esconderia justamente o que já deu bug aqui: unique, FK, cascade e
   transação.
3. **Pelo HTTP sempre que possível.** `app.inject()` passa pelo
   middleware, pelo `errorHandler` e pela serialização. Teste direto no
   service ou no repositório só quando a regra não é alcançável pela rota
   ou quando o caso precisa de um estado que a API não cria (ex.: versões
   de schedule no passado).
4. **Todo teste de bug falha antes da correção.** Se o teste passa no
   código antigo, ele não prova nada.
5. **O teste confere o banco, não só o status.** Num `403` ou num `400`,
   o teste confere também que nada foi gravado.

## Pirâmide

| Camada | Onde | Velocidade | O que cobre |
|---|---|---|---|
| Unitário | `scheduleLogic.test.ts`, `date.test.ts`, `schemas.test.ts`, `secretKey.test.ts`, `attemptTracker.test.ts` | ms, sem banco | Regras puras: dia-alvo, dia local, limites dos schemas, guard da chave, rate limit por conta |
| Arquitetura | `checkinRepositoryBoundary.test.ts`, `layering.test.ts` | ms | Quem pode importar o quê. Leem o código-fonte, não executam |
| Repositório e service | `pathA.test.ts`, `backfill.test.ts`, `transactions.test.ts` | dezenas de ms | Estado que a API não cria sozinha, falha no meio de uma transação |
| Integração HTTP | o restante | dezenas de ms | Contrato, autorização, fluxo completo |
| Concorrência | `concurrency.test.ts` | dezenas de ms | Corridas, com barreira determinística (`helpers/barrier.ts`) |

Não há testes E2E com cliente real. O contrato é coberto pelos testes de
integração HTTP contra `docs/API-REFERENCE.md`.

## Matriz de risco

O que cada área precisa ter coberto e onde está. Quando uma rota nova
entra, ela entra aqui também.

### Autenticação (`Auth.ts`)

| Caso | Esperado | Teste |
|---|---|---|
| Sem header / `Bearer` sem token | 401 | `auth.test.ts`, `gaps.test.ts` |
| Token malformado, expirado, outra chave, outro algoritmo, `alg: none`, assinatura adulterada | 401 | `authEdgeCases.test.ts` |
| Payload sem `id`, `id` vazio, sem `role`, `role` fora do enum, payload string | 401 | `authEdgeCases.test.ts` |
| Esquema diferente de `Bearer`, token sem esquema, partes demais | 401 | `authEdgeCases.test.ts` |
| `SECRET_KEY` ausente no runtime | 500 sem vazar detalhe | `gaps.test.ts`, `bugfixes.test.ts` |
| Rota de admin com usuário comum / com token inválido | 403 / 401 | `auth.test.ts`, `authEdgeCases.test.ts` |
| Token de conta apagada | **em aberto** (ADR-0008) | `deletedUserSession.test.ts` (`it.todo`) |

### Autorização por recurso

| Rota | Dono | Outro usuário | Admin | Inexistente |
|---|---|---|---|---|
| `PATCH /users/:id` | 200 | 403 | 403 | 404 |
| `DELETE /users/:id` | 200 | 403 | 200 (alvo comum) / 403 (alvo admin) | 404 |
| `GET /users` | — | 403 | 200 | — |
| `GET /users/:userId/habits` | 200 | 403 | 200 | 404 |
| `PATCH` / `DELETE /habits/:id` | 200 | 403 | 403 | 404 |
| `POST` / `DELETE /habits/:habitId/checkin` | 201 / 200 | 403 | ADR-0005 | 404 |
| `GET /habits/:habitId/checkins` | 200 | 403 | ADR-0005 | 404 |
| `GET /users/:userId/checkins` | 200 | 403 | 200 | 404 |

Testes: `ownership.test.ts`, `adminUserRules.test.ts`,
`checkinAccess.test.ts`, `gaps.test.ts`. As células "ADR-0005" ficam sem
teste novo até o ADR ser decidido.

### Integridade de dados

| Regra | Teste |
|---|---|
| Streak, grace token gasto e devolvido no undo, teto de 3 | `graceFillUndo.test.ts`, `timezoneFrozen.test.ts` |
| Reposição mensal de grace token (meses UTC, virada de ano, teto) | `habitScheduleAndGrace.test.ts` |
| Versionamento de schedule pelo PATCH, schedule inválido não cria versão | `habitScheduleAndGrace.test.ts`, `pathA.test.ts` |
| Undo é evento compensatório, nunca DELETE | `checkinAccess.test.ts`, `pathA.test.ts` |
| Tudo ou nada por caso de uso | `transactions.test.ts` |
| Corridas no mesmo hábito | `concurrency.test.ts` |
| Cascade ao apagar a conta (hábitos, refresh tokens) | `adminUserRules.test.ts`, `deletedUserSession.test.ts` |
| Dia local: fuso, meia-noite, horário de verão, fuso de meia hora | `date.test.ts` |
| Timezone fixo depois do cadastro, allowlist do PATCH | `timezoneFrozen.test.ts`, `schemas.test.ts` |

### Erros e limites

| Caso | Teste |
|---|---|
| Zod → 400 com `details` | `bugfixes.test.ts`, `userValidation.test.ts` |
| JSON malformado 400, corpo grande 413, Content-Type 415 | `clientErrors.test.ts` |
| P2002 por constraint, P2025 → 404 | `conflicts.test.ts` |
| Rate limit por IP (`/users` 5/h, `/login` 20/min) e por conta | `rateLimit.test.ts`, `attemptTracker.test.ts` |

## Como escrever um teste novo

- **Dados:** use `src/__tests__/helpers/factories.ts`.
  - `createUser()` e `createAdmin()` gravam direto no banco, com senha
    `DEFAULT_PASSWORD` (o login funciona) e um token de `signAccessToken`.
  - Não use `POST /users` só para preparar dados: o rate limit de 5 por
    hora por instância do app quebra o arquivo no 6º usuário.
  - **Não assine token de admin com id inventado.** Isso esconde os bugs
    de "usuário do token não existe".
- **Limpeza:** `deleteUsers([...])` no `afterAll`. Hábitos, logs e
  refresh tokens saem por cascade.
- **Isolamento:** cada teste prepara o próprio estado. Se dois testes
  precisam rodar em ordem, eles são um teste só.
- **Rate limit:** o contador fica em memória por instância do app. Teste
  de rate limit sobe um app novo por caso (`beforeEach`) e chama
  `attemptTracker.reset()` no fim.
- **Tempo:** `vi.useFakeTimers({ toFake: ["Date"] })`, só o `Date`, para
  o Prisma e o Fastify continuarem com timers reais. Com o relógio
  adiantado, o token de 1h do factory expira. Use
  `signRaw(payload, { expiresIn: "3650d" })`.
- **Corrida:** use `helpers/barrier.ts`. Nada de `setTimeout` para
  "provavelmente" sobrepor duas requisições.
- **Decisão em aberto:** se o comportamento esperado depende de um ADR
  `Proposto`, escreva `it.todo` citando o ADR. Não trave o comportamento
  atual num teste.

## Cobertura

- `npm run test:coverage` roda a suíte com cobertura. O CI usa esse
  comando, então um piso violado quebra o build.
- Os pisos ficam em `vitest.config.ts` (`coverage.thresholds`):

| Escopo | Linhas | Branches |
|---|---|---|
| Global | 95% | 87% |
| `Middleware/Auth.ts` | 100% | 100% |
| `Middleware/habitAccess.ts`, `Middleware/errorHandler.ts` | 100% | 80% |
| `services/checkinServices.ts` | 90% | 80% |
| `controllers/CheckinController.ts` | 90% | 85% |

- **Piso, não meta.** O piso fica um pouco abaixo do valor medido (96,6%
  das linhas e 88,9% dos branches em 2026-11-20) para não quebrar por
  oscilação. Ele só sobe: quando um PR aumenta a cobertura de forma
  estável, o piso sobe junto.
- Ficam fora da conta `src/generated/`, `src/server.ts` e os três pontos
  de entrada de CLI em `src/scripts/`. A lógica desses scripts mora em
  módulos testados (ex.: `habitScheduleBackfill.ts`).
- Cobertura mostra o que **não** foi executado. Ela não prova que o que
  foi executado está certo. A matriz de risco acima é o critério; a
  porcentagem é só um alarme.

## Dívida conhecida

| Item | Por que importa | Caminho |
|---|---|---|
| `gaps.test.ts` e `ownership.test.ts` usam admin com id inventado | Esconde o bug do ADR-0008 | Migrar para `createAdmin()` |
| `ownership.test.ts` depende da ordem dos testes | Rodar um teste isolado pode dar outro resultado | Cada teste cria o próprio usuário |
| `createUserAndLogin` copiado em vários arquivos | Mudança no cadastro exige editar N arquivos | Migrar para as factories |
| Streak (`computeTailStreak`, `recalculateLongestStreak`) só testado pelo HTTP | Teste de borda de streak é lento e indireto | Extrair para `src/domain/` como já foi feito com `schedule.ts` e testar unitário |
| `cors.ts` e `cookies.ts` com o ramo de produção sem teste | Config errada só aparece em produção | Teste unitário com `NODE_ENV=production` |
| Admin nas rotas de check-in | Depende do ADR-0005 | Escrever os testes quando o ADR for decidido |
