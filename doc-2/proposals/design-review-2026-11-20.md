# Revisão de design do LOOP API (2026-11-20)

> Escrito no commit `b8700bb` e revisto no `e49d0ef` (2026-11-21), depois
> dos PRs #26 a #30. Os comportamentos marcados com **[reproduzido]**
> foram executados contra a API rodando em container (imagem do
> [plano de Docker](./containerizacao-docker.md)) com Postgres 16, no
> `b8700bb`. As referências de arquivo e linha apontam para o `e49d0ef`.

Este documento é uma proposta. Nada aqui muda código. As escolhas que
têm trade-off real viraram ADRs com status `Proposto` (0016 a 0019) e
esperam decisão do dono do projeto. O número de um ADR segue a ordem em
que ele entra na `main`. Se outro ADR entrar antes, estes mudam de
número.

## 0. O que a `main` já resolveu desde a primeira versão

| Achado | Situação no `e49d0ef` |
|---|---|
| S1: JSON inválido devolvia `500` | Corrigido no PR #28. O `errorHandler` respeita o `statusCode` dos erros do Fastify. |
| S3: todo `P2002` virava "Email já cadastrado." | Corrigido no PR #26 (issue #18). A mensagem depende da constraint. `P2025` virou `404`. |
| C1 e D5: check-in e undo sem transação | Corrigido no PR #26. Transação por caso de uso com `SELECT ... FOR UPDATE` no `Habit`, [ADR-0009](../adr/0009-unidade-de-trabalho-por-caso-de-uso.md) (`Proposto`, opção A implementada). A ADR que esta revisão propunha para isso foi retirada por ser a mesma pergunta. |
| R6: admin fazia check-in no hábito alheio, mas não editava | Corrigido no PR #26. Só o dono age nas rotas do hábito (`requireHabitAccess`), [ADR-0011](../adr/0011-politica-de-acesso-ao-habito.md) (`Proposto`, opção A implementada). |
| Hospedagem | A API saiu do Render e roda na Vercel desde o PR #27, sem ADR. Ver [ADR-0019](../adr/0019-runtime-de-deploy.md). |
| D8: `dotenv` sem declaração no `package.json` | Corrigido no PR #33. |
| Referência HTTP | Spec OpenAPI escrita à mão e servida em `/docs` (PR #30, [ADR-0008](../adr/0008-documentacao-openapi.md)). |

O resto continua valendo e está atualizado abaixo.

## 1. Premissas

Requisitos funcionais (o que existe hoje): cadastro e login, CRUD de
hábitos com agenda versionada (`DAILY`, `WEEKLY`, `INTERVAL`),
check-in e undo, streak atual e recorde, grace token mensal, refresh
token em cookie para o `loop-web`.

Requisitos não funcionais que este documento assume, porque não estão
escritos em lugar nenhum:

| Item | Premissa |
|---|---|
| Usuários | Até 10 mil ativos por dia no primeiro ano |
| Carga | ~5 hábitos por usuário, ~1 a 3 check-ins por hábito por dia, leitura de listas a cada abertura do app |
| Pico | 10x a média, concentrado de manhã e à noite no fuso do usuário |
| Latência | p95 < 300 ms nas rotas de check-in e listagem |
| Disponibilidade | 99,5%, sem exigência de multi-região |
| Equipe | 1 pessoa, projeto de aprendizado público |

Estimativa com essas premissas: 10 mil × 5 × 3 ≈ 150 mil check-ins por
dia, ou ~2 por segundo em média e ~20 por segundo no pico. Em um ano,
`HabitLog` chega perto de 55 milhões de linhas no pior caso. Volume de
requisição não é o gargalo. Os problemas reais são **correção sob
concorrência** e **leituras que crescem sem limite** com o histórico.

## 2. Visão geral

```
                      ┌────────────────────────────── LOOP API (Fastify, stateless no JWT) ─────┐
[app mobile] ──┐      │ routes ─> preHandler auth ─> controllers (Zod) ─> services ─> repository │
               ├─HTTPS┤                                                         │                │
[loop-web]  ───┘      │ estado em memória: rate limit por IP, attemptTracker  │                │
                      └────────────────────────────────────────────────────────┼────────────────┘
                                                                               ▼
                                                              [PostgreSQL 16 no Neon]

Produção: Vercel Function (api/index.ts). Dev e qualquer host de processo longo: src/server.ts.
```

O que já está bom e deve ser mantido:

- Separação em camadas e a fronteira do repositório garantida por teste
  (`checkinRepositoryBoundary.test.ts`).
- `HabitLog` só cresce e o undo é um evento (I3). Isso facilita auditoria
  e recálculo.
- Agenda versionada com selamento de dia fechado (I2).
- JWT de acesso sem estado. A API escala horizontalmente sem sessão
  compartilhada, com as exceções da seção 5.
- Argon2id com parâmetros explícitos e hash dummy contra timing.

## 3. Modelo de dados (`prisma/schema.prisma`)

### 3.1 Problemas

| # | Problema | Evidência | Impacto |
|---|---|---|---|
| D1 | `Habit.userId` não tem índice. O Postgres não cria índice para FK sozinho. | `schema.prisma:46`. Nenhum `CREATE INDEX` em `Habit` nas migrations. | `GET /me/habits`, `GET /users/:id/habits` e `GET /users/:id/checkins` (join por `habit.userId`) fazem seq scan em `Habit`. |
| D2 | Email é único com diferença entre maiúsculas e minúsculas. **[reproduzido]** `t@x.com` e `T@x.com` viram duas contas. | `schema.prisma:13`, `userVal.ts:12` | Duas contas para a mesma pessoa. O login só acha uma delas. O `attemptTracker` normaliza para minúsculas (`attemptTracker.ts:37`) e o banco não, então os dois discordam sobre quem é "o mesmo email". |
| D3 | `findUndoableCheckIn` ordena por `checkedAt` e filtra por `undoneBy: null`, e não existe índice que cubra isso. | `checkinRepository.ts:37-42` | Cresce com o histórico do hábito. |
| D4 | `RefreshToken` nunca é apagado. Token expirado ou revogado fica para sempre. | `refreshTokenServices.ts` não tem limpeza | Tabela cresce sem limite. Cada login cria uma linha. |
| D5 | ~~`graceTokens` e `longestStreak` atualizados fora de transação.~~ | Resolvido no PR #26 | Ver a seção 0. |
| D6 | `HabitSchedule` não tem restrição no banco para os campos por tipo (`daysOfWeek` só em `WEEKLY`, `intervalDays` só em `INTERVAL`). Só o Zod garante. | `schema.prisma:77-78` | Uma escrita fora da rota (script, backfill) pode gravar agenda inválida. |
| D7 | Nenhuma restrição garante uma única versão vigente (`effectiveTo IS NULL`) por hábito. | `createScheduleVersion`, `checkinRepository.ts:114` | A trava da ADR-0009 cobre check-in e undo, não a edição de agenda. Dois `PATCH` concorrentes com `schedule` podem deixar duas versões abertas, e `find(s => s.effectiveTo === null)` pega a primeira que achar. |
| D8 | ~~`dotenv` importado sem estar no `package.json`.~~ | Resolvido no PR #33 | Ver a seção 0. |

### 3.2 Mudanças propostas

Todas precisam de migration, e pelo protocolo do projeto migration só
entra com aprovação explícita.

```prisma
model User {
  // D2: normalizar no Zod (.toLowerCase().trim()) E garantir no banco.
  // Opção sem extensão: índice único em lower(email), criado em SQL cru
  // na migration, já que o Prisma não declara índice de expressão.
  email String @unique
}

model Habit {
  // ...
  @@index([userId, name])        // D1: cobre o filtro e o orderBy de GET /me/habits
}

model HabitLog {
  // ...
  @@index([habitId, date])       // já existe
  @@index([habitId, checkedAt])  // D3
}

model RefreshToken {
  // ...
  @@index([expiresAt])           // D4: torna barato o DELETE periódico de expirados
}
```

SQL cru na mesma migration, para o que o Prisma não declara:

```sql
-- D2 (antes, deduplicar as contas que já colidem)
CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower(email));

-- D7: no máximo uma versão vigente por hábito
CREATE UNIQUE INDEX "HabitSchedule_one_open_per_habit"
  ON "HabitSchedule" ("habitId") WHERE "effectiveTo" IS NULL;

-- D6
ALTER TABLE "HabitSchedule" ADD CONSTRAINT "schedule_fields_by_type" CHECK (
  ("type" = 'WEEKLY'   AND cardinality("daysOfWeek") > 0 AND "intervalDays" IS NULL) OR
  ("type" = 'INTERVAL' AND "intervalDays" > 0 AND cardinality("daysOfWeek") = 0) OR
  ("type" = 'DAILY'    AND "intervalDays" IS NULL AND cardinality("daysOfWeek") = 0)
);
ALTER TABLE "HabitSchedule" ADD CONSTRAINT "target_positive" CHECK ("targetPerDay" > 0);
```

D4: um job que roda `DELETE FROM "RefreshToken" WHERE "expiresAt" < now() - interval '1 day'`.
Pode ser um cron do provedor ou um comando `node dist/jobs/cleanup.js`
no mesmo container.

A mudança de modelo que depende de decisão (colunas materializadas de
streak) está no [ADR-0018](../adr/0018-custo-do-calculo-de-streak.md).

## 4. Rotas REST

### 4.1 Mapa atual

| Método e rota | Auth | Sucesso | Observação |
|---|---|---|---|
| `POST /users` | não | 201 | cadastro |
| `GET /users` | admin | 200 | sem paginação |
| `PATCH /users/:id` | dono | 200 | |
| `DELETE /users/:id` | dono ou admin | 200 + corpo | |
| `POST /login` | não | 200 | |
| `POST /refresh` | cookie | 200 | |
| `POST /logout` | cookie | 200 | |
| `POST /habits` | user | 201 | |
| `GET /habits` | admin | 200 | todos os hábitos do sistema, sem paginação |
| `GET /me/habits` | user | 200 | duplica `GET /users/:userId/habits` |
| `GET /users/:userId/habits` | dono ou admin | 200 | |
| `PATCH /habits/:id` | dono | 200 | `requireHabitAccess` |
| `DELETE /habits/:id` | dono | 200 + corpo | `requireHabitAccess` |
| `POST /habits/:habitId/checkin` | dono | 201 | `requireHabitAccess` (ADR-0011) |
| `DELETE /habits/:habitId/checkin` | dono | 200 | desfaz "o último", não um recurso identificado |
| `GET /habits/:habitId/checkins` | dono | 200 | sem paginação, cresce para sempre |
| `GET /users/:userId/checkins` | dono ou admin | 200 | sem paginação, todos os hábitos juntos |

### 4.2 Problemas

**Nomes e forma**

- R1. Não existe `GET /habits/:id` nem `GET /me`. O cliente precisa
  listar tudo para mostrar um hábito.
- R2. `/me/habits` e `/users/:userId/habits` fazem a mesma coisa para o
  próprio usuário. Duas rotas, dois caminhos de autorização.
- R3. `DELETE /habits/:habitId/checkin` não aponta para um recurso. Um
  retry de rede desfaz **dois** check-ins, porque cada chamada pega "o
  último não desfeito". O verbo `DELETE` promete idempotência que a rota
  não cumpre.
- R4. Parâmetros com nomes diferentes para a mesma coisa (`:id` e
  `:habitId`). Nenhum parâmetro de rota passa por validação, então um id
  qualquer vai direto para o Prisma.
- R5. `/login`, `/refresh` e `/logout` ficam soltos na raiz. Sem prefixo
  de versão, qualquer mudança de contrato quebra os clientes de uma vez.
- ~~R6. Regras de admin inconsistentes.~~ Resolvido no PR #26 (seção 0).

**Status codes**

| # | Caso | Hoje | Correto |
|---|---|---|---|
| S1 | ~~Corpo com JSON inválido~~ **[reproduzido]** | era `500` | `400`. Corrigido no PR #28. |
| S2 | Rota inexistente **[reproduzido]** | `404` com `{ message, error, statusCode }`, um terceiro formato | `404` no formato padrão |
| S3 | ~~Dois undos simultâneos~~ **[reproduzido]** | era `409 "Email já cadastrado."` | Corrigido no PR #26: a trava serializa os undos, e um `P2002` em `HabitLog` ou `GraceFill` vira mensagem de conflito. |
| S4 | Undo sem check-in para desfazer (`CheckinController.ts:26`) | `400` | `404` ou `409` (a requisição está bem formada) |
| S5 | `DELETE` com sucesso | `200` com o objeto apagado | `204` sem corpo, ou manter `200` de propósito |
| S6 | Recurso de outra pessoa | `404` se não existe, `403` se existe | Ids são cuid2, então dá para enumerar pouco. Aceitável, mas vale decidir de propósito. |

S2 continua aberto: a API não registra `setNotFoundHandler`, então o
404 de rota inexistente sai no formato do Fastify.

**Formato dos erros**

Hoje existem quatro formatos:

```jsonc
{ "error": "Hábito não encontrado." }                                   // controllers e demais 4xx
{ "error": "Dados inválidos.", "details": [{ "campo": "...", "message": "..." }] }  // Zod
{ "statusCode": 500, "error": "Internal Server Error", "reqId": "req-1" } // 500 e 429
{ "message": "Route GET:/x not found", "error": "Not Found", "statusCode": 404 }    // 404 do Fastify
```

O cliente não tem um código estável para decidir o que fazer. Ele só
tem a frase em português, que muda quando alguém revisa o texto. Os
`details` misturam chave em português (`campo`) com chave em inglês
(`message`). As opções estão no
[ADR-0016](../adr/0016-formato-de-erro.md).

**Paginação**

Nenhuma listagem é paginada. As que crescem sem limite são as de
check-ins (todo o histórico) e as de admin (todos os usuários, todos os
hábitos). As opções estão no
[ADR-0017](../adr/0017-paginacao.md).

### 4.3 Contrato-alvo (depende dos ADRs 0016, 0017 e 0019)

Esboço para discussão. Ele mostra a forma, e os detalhes seguem as
escolhas dos ADRs.

```
GET    /health/live                         200  processo de pé (sem banco)
GET    /health/ready                        200  banco responde; 503 se não

POST   /v1/auth/login                       200
POST   /v1/auth/refresh                     200
POST   /v1/auth/logout                      204

POST   /v1/users                            201  Location: /v1/users/{id}
GET    /v1/users/me                         200
PATCH  /v1/users/me                         200
DELETE /v1/users/me                         204
GET    /v1/users?limit=&cursor=             200  admin
DELETE /v1/users/{id}                       204  admin

POST   /v1/habits                           201  Location: /v1/habits/{id}
GET    /v1/habits?limit=&cursor=            200  hábitos do usuário autenticado
GET    /v1/habits/{id}                      200
PATCH  /v1/habits/{id}                      200
DELETE /v1/habits/{id}                      204

POST   /v1/habits/{id}/checkins             201  Location: .../checkins/{checkinId}
GET    /v1/habits/{id}/checkins?from=&to=&limit=&cursor=   200
DELETE /v1/habits/{id}/checkins/{checkinId} 204  idempotente: 2ª chamada também 204 (ou 404)
GET    /v1/checkins?from=&to=&limit=&cursor=               200  todos os hábitos do usuário

GET    /v1/admin/habits?userId=&limit=&cursor=             200  admin
```

O que muda e por quê:

- `/me` vira o caminho do próprio usuário, e `/users/{id}` fica só para
  admin. O `requireHabitAccess` do PR #26 já centraliza a regra das
  rotas de hábito, e o `/me` estende a ideia para as de usuário.
- O undo passa a apontar para um check-in específico (R3). Continua
  sendo um evento `UNDO` no banco, e a invariante I3 não muda. O cliente
  já recebe o `checkin.id` no `201` do check-in.
- `from` e `to` (dias locais, `YYYY-MM-DD`) nas listagens de check-in
  permitem que o app peça "o mês visível" em vez do histórico inteiro.
- Parâmetros de rota validados com `z.cuid2()` antes do controller (R4).
- Uma forma de migrar sem quebrar os clientes: subir `/v1` ao lado das
  rotas antigas, marcar as antigas com o header `Deprecation`, e remover
  depois que mobile e `loop-web` migrarem. Os dois clientes ainda estão
  em construção, então a janela pode ser curta.

## 5. Escalar: o que muda, em ordem

### 5.1 Correção antes de volume

- **C1. Check-in e undo não eram atômicos.** Resolvido no PR #26 (seção
  0). Na primeira versão desta revisão, 4 undos simultâneos geraram 2
  sucessos e 2 respostas `409 "Email já cadastrado."` **[reproduzido]**.
  A ADR-0009 cobre a pergunta e as opções.

- **C2. Idempotência de escrita.** Retry de rede em `POST .../checkin`
  cria dois check-ins (com `targetPerDay > 1`, isso conta como progresso
  real). Proposta: aceitar o header `Idempotency-Key` em `POST` de
  check-in, guardar a chave com o id do evento criado (coluna única em
  `HabitLog` ou uma tabela própria com TTL) e devolver a mesma resposta
  em caso de repetição.

### 5.2 Leituras que crescem com o histórico

- **C3. Streak lê o log inteiro, várias vezes, a cada escrita.**
  `getEffectiveLog` busca todos os eventos e todos os grace fills do
  hábito (`checkinRepository.ts:193-219`). `CreateCheckIn` e
  `UndoCheckIn` chamam essa função 2 vezes cada. Um hábito diário com 3
  anos tem ~1.100 dias e alguns milhares de eventos: cabe em memória,
  mas cada check-in passa a custar milissegundos de banco e de CPU
  proporcionais ao histórico inteiro. Desde o PR #26 isso acontece com
  a trava do hábito e uma conexão do pool presas.
  As opções estão no [ADR-0018](../adr/0018-custo-do-calculo-de-streak.md).
- **C4. Listagens sem limite.** Ver ADR-0017.
- **C5. Índices.** Ver D1 e D3.

### 5.3 Rodar mais de uma instância

- **C6. Estado em memória.** O rate limit por IP (`@fastify/rate-limit`
  sem store) e o `attemptTracker` vivem no processo. Na Vercel isso já
  acontece hoje: cada instância da Function tem o próprio contador, e
  uma instância nova começa do zero. Em container, o mesmo vale a partir
  da segunda réplica. O próprio código já prevê a troca
  (`attemptTracker.ts:3`). O caminho é um Redis compartilhado: o
  `@fastify/rate-limit` aceita `redis` como store, e o tracker precisa
  de uma implementação com `INCR` e `PEXPIRE`. Na Vercel, um Redis
  gerenciado por HTTP (ex.: Upstash) evita abrir conexão TCP por
  invocação. A [ADR-0019](../adr/0019-runtime-de-deploy.md) trata do
  runtime.
- **C7. Conexões com o banco.** Cada instância abre um pool do Prisma
  (padrão: `num_cpus * 2 + 1`). Na Vercel, a `DATABASE_URL` de runtime
  já aponta para o pooler do Neon (PgBouncer em modo transação, ver o
  comentário em `scripts/vercel-migrate.mjs`). Em container com várias réplicas,
  controlar com `?connection_limit=` e, acima de umas 5 réplicas, usar o
  mesmo pooler (`?pgbouncer=true` no Prisma).
- **C8. Desligamento (processo longo: dev e container).** O
  `src/server.ts` não trata `SIGTERM`. Na Vercel não se aplica. **[reproduzido]** `docker compose stop` esperou os 10 s
  de timeout e matou o processo. Em deploy com rolling update, as
  requisições em andamento caem. Proposta: no `SIGTERM`, chamar
  `server.close()` (o Fastify para de aceitar conexões e espera as que
  estão abertas) e depois `prisma.$disconnect()`.
- **C9. Health check.** Não existe rota de saúde. Orquestrador e
  balanceador precisam de uma para saber quando mandar tráfego. Ver o
  contrato em 4.3.
- **C10. Memória do Argon2.** Cada hash usa 64 MiB
  (`userServices.ts:22`). O threadpool do libuv tem 4 threads por
  padrão, então o pico é de ~256 MiB só para hashes simultâneos, mais o
  heap do Node. O container precisa de pelo menos 512 MiB. Abaixo
  disso, um pico de logins mata o processo por OOM.

### 5.4 Observabilidade

O Fastify já loga em JSON (pino) com `reqId`. Falta:

- Devolver o `reqId` em um header (`x-request-id`) em toda resposta,
  não só no 500. Assim o cliente consegue reportar o erro.
- Métricas mínimas: latência por rota, taxa de 5xx, pool de conexões do
  Prisma. Um endpoint `/metrics` (Prometheus) ou o APM do provedor.
- Alertas iniciais: 5xx > 1% em 5 min, p95 de `POST .../checkin` >
  500 ms, `ready` falhando.

### 5.5 O que revisitar quando crescer

| Gatilho | Revisitar |
|---|---|
| `HabitLog` passando de ~50 milhões de linhas | Particionar `HabitLog` por intervalo de `date`, ou arquivar eventos de dias selados em tabela fria |
| Leitura muito maior que escrita | Réplica de leitura para listagens. Cache só se a réplica não bastar, já que streak muda a cada check-in |
| Notificações ou lembretes | Fila (pg-boss no próprio Postgres antes de introduzir um broker) |
| Spec OpenAPI divergindo das rotas com frequência | Gerar a spec a partir de schemas nas rotas em vez de manter à mão (alternativa descartada por enquanto na ADR-0008) |

## 6. Ordem sugerida de execução

Sem depender de decisão (correção de bug, sem mudança de contrato
intencional):

1. `setNotFoundHandler` para o 404 sair no formato da API (S2).
2. `SIGTERM` em `src/server.ts` e `/health/*` (C8, C9).
3. Dockerfile e compose para dev e CI ([plano](./containerizacao-docker.md)).

Precisam de aprovação de migration:

4. Índices D1, D3, D4 e restrições D6, D7.
5. Email sem diferença de maiúsculas (D2), com deduplicação antes.

Precisam de decisão nos ADRs:

6. [ADR-0016](../adr/0016-formato-de-erro.md) formato de erro e
   [ADR-0017](../adr/0017-paginacao.md) paginação, juntos com o `/v1`.
7. [ADR-0018](../adr/0018-custo-do-calculo-de-streak.md) custo do streak.
8. [ADR-0019](../adr/0019-runtime-de-deploy.md) manter a Vercel ou ir para container.
9. As ADRs 0009 e 0011 da `main` estão `Proposto` com a opção A já
   implementada. Falta só aceitar ou trocar.
