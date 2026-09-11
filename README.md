# LOOP

A backend REST API for a habit tracker — JWT auth, role-based access control,
timezone-aware streaks, versioned habit schedules, and layered login
brute-force defense. Built as a portfolio project, deliberately treated as
production software, with every non-trivial architectural choice recorded as
proposal → counter-argument → decision → discarded alternative.

[![CI](https://github.com/IgorCGouveia/LOOP/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorCGouveia/LOOP/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-000000?style=for-the-badge&logo=fastify&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)
![Zod](https://img.shields.io/badge/Zod-3E67B1?style=for-the-badge&logo=zod&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)
![Render](https://img.shields.io/badge/Render-46E3B7?style=for-the-badge&logo=render&logoColor=white)

**Live:** https://loop-api-wz74.onrender.com _(free tier — first request after
idle can take 30-60s to wake up)_

<p align="center">
  <a href="#english"><img src="https://img.shields.io/badge/🇺🇸-English-blue?style=for-the-badge" /></a>
  <a href="#português"><img src="https://img.shields.io/badge/🇧🇷-Português-green?style=for-the-badge" /></a>
</p>

---

## English

### Overview

LOOP is a headless API — there's no frontend here, the HTTP contract is the
deliverable. A user signs up, logs in, creates habits with a schedule
(daily / specific weekdays / every N days and a target count per day), and
checks in. The API derives streaks, applies a limited monthly "streak
freeze" grace token, and enforces ownership so a user can only touch their
own data (admins can read/manage everyone's).

### Tech stack

| Layer | Tool |
|---|---|
| Language | TypeScript (strict) |
| Runtime | Node.js 24 |
| HTTP framework | Fastify 5 |
| ORM / DB | Prisma 6 + PostgreSQL |
| Validation | Zod (schemas double as inferred types) |
| Auth | JWT (`jsonwebtoken`) + Argon2id password hashing |
| Rate limiting | `@fastify/rate-limit` (IP layer) + a hand-rolled account-level delay tracker |
| Tests | Vitest, integration tests via `app.inject()` against a real Postgres — no DB mocking |
| CI | GitHub Actions (service Postgres, type-check gate, test suite) |
| Deploy | Render (Web Service + managed Postgres) |

### Highlights

- **Ownership checks resolved from the database**, not trusted from the
  request — closes the classic IDOR hole.
- **Versioned habit schedule** (slowly-changing dimension): editing a
  habit's frequency/target never rewrites the verdict of already-closed
  days. Reprojects the count when the target changes but the day stays
  scheduled; seals it when the day drops out of the schedule entirely.
- **Timezone-aware streaks**: mandatory IANA timezone at signup, day
  boundary frozen at write time, a day "closes" the instant it stops being
  "today" in the user's zone — no cron, no background job.
- **Login brute-force defense without account lockout**: progressive delay
  per identifier (not a hard deny — a lockout is itself a denial-of-service
  vector), symmetric between success and failure (skipping the delay on a
  correct password would leak a timing oracle), with a concurrency cap so
  the defense can't be turned into a connection-exhaustion attack, and a
  memory-bounded store so it can't be turned into a memory-exhaustion one
  either.
- **Boot-time config validation**: the server refuses to start with a
  missing, too-short, or placeholder `SECRET_KEY`, instead of failing
  silently on the first request.

### API

All bodies are JSON. Protected routes take `Authorization: Bearer <token>`.

| Method | Route | Auth | Notes |
|---|---|---|---|
| POST | `/users` | — | sign up (rate-limited by IP) |
| POST | `/login` | — | returns a JWT (rate-limited by IP + account) |
| GET | `/users` | admin | list all users |
| PATCH | `/users/:id` | owner | partial update |
| DELETE | `/users/:id` | owner or admin | |
| POST | `/habits` | user | create habit + schedule |
| GET | `/me/habits` | user | list own habits |
| GET | `/users/:userId/habits` | owner or admin | |
| GET | `/habits` | admin | list all |
| PATCH | `/habits/:id` | owner | `schedule`, if present, must be the full object |
| DELETE | `/habits/:id` | owner | |
| POST | `/habits/:habitId/checkin` | owner | |
| DELETE | `/habits/:habitId/checkin` | owner | undo the last check-in |
| GET | `/habits/:habitId/checkins` | owner | |
| GET | `/users/:userId/checkins` | owner or admin | |

### Running locally

Requires Node 24 and a PostgreSQL instance.

```bash
git clone https://github.com/IgorCGouveia/LOOP.git
cd LOOP
npm install
```

Create a `.env` file:

```
DATABASE_URL="postgresql://user:password@localhost:5432/loop?schema=public"
SECRET_KEY="a random string of at least 32 characters"
```

```bash
npx prisma migrate deploy   # apply the schema
npm run dev                 # tsx watch, no build step
npm test                    # vitest, runs against the real DB above
npm run build && npm start  # production build
```

### License

[MIT](./LICENSE)

---

## Português

### Visão geral

LOOP é uma API sem interface visual — não tem frontend, o contrato HTTP é o
entregável. Um usuário se cadastra, faz login, cria hábitos com uma agenda
(diário / dias específicos da semana / a cada N dias, com uma meta de vezes
por dia) e registra check-ins. A API deriva streaks, aplica um token
limitado de "streak freeze" com reposição mensal, e impõe posse de recurso —
usuário só mexe nos próprios dados (admin lê/gerencia de todos).

### Stack técnica

| Camada | Ferramenta |
|---|---|
| Linguagem | TypeScript (`strict`) |
| Runtime | Node.js 24 |
| Framework HTTP | Fastify 5 |
| ORM / Banco | Prisma 6 + PostgreSQL |
| Validação | Zod (schemas também geram os tipos, via `z.infer`) |
| Auth | JWT (`jsonwebtoken`) + hash de senha Argon2id |
| Rate limiting | `@fastify/rate-limit` (camada de IP) + um tracker de atraso por conta feito à mão |
| Testes | Vitest, testes de integração via `app.inject()` contra um Postgres real — sem mock de banco |
| CI | GitHub Actions (Postgres de serviço, gate de tipo, suíte de testes) |
| Deploy | Render (Web Service + Postgres gerenciado) |

### Destaques

- **Posse de recurso resolvida no banco**, nunca confiando no que vem na
  requisição — fecha o vetor clássico de IDOR.
- **Agenda de hábito versionada** (*slowly-changing dimension*): editar a
  frequência/meta de um hábito nunca reescreve o veredito de dias já
  fechados. Reprojeta a contagem quando só a meta muda e o dia continua
  agendado; tranca quando o dia sai da agenda de vez.
- **Streak com fuso horário**: timezone IANA obrigatório no cadastro,
  fronteira do dia congelada na escrita, um dia "fecha" no instante em que
  deixa de ser "hoje" no fuso do usuário — sem cron, sem job em background.
- **Defesa contra brute force de login sem bloquear a conta**: atraso
  progressivo por identificador (não é bloqueio — um lockout é, ele mesmo,
  um vetor de negação de serviço), simétrico entre sucesso e falha (pular
  o atraso quando a senha está certa vazaria um oráculo de timing), com cap
  de concorrência pra não deixar a própria defesa virar ataque de exaustão
  de conexão, e store limitado em memória pra não virar exaustão de
  memória.
- **Validação de configuração no boot**: o servidor recusa subir com
  `SECRET_KEY` ausente, curta demais ou um valor de exemplo — em vez de
  falhar silenciosamente na primeira requisição.

### API

Todos os corpos são JSON. Rotas protegidas usam `Authorization: Bearer <token>`.

| Método | Rota | Auth | Observação |
|---|---|---|---|
| POST | `/users` | — | cadastro (rate limit por IP) |
| POST | `/login` | — | devolve um JWT (rate limit por IP + por conta) |
| GET | `/users` | admin | lista todos os usuários |
| PATCH | `/users/:id` | dono | atualização parcial |
| DELETE | `/users/:id` | dono ou admin | |
| POST | `/habits` | usuário | cria hábito + agenda |
| GET | `/me/habits` | usuário | lista os próprios hábitos |
| GET | `/users/:userId/habits` | dono ou admin | |
| GET | `/habits` | admin | lista todos |
| PATCH | `/habits/:id` | dono | `schedule`, se vier, tem que ser o objeto completo |
| DELETE | `/habits/:id` | dono | |
| POST | `/habits/:habitId/checkin` | dono | |
| DELETE | `/habits/:habitId/checkin` | dono | desfaz o último check-in |
| GET | `/habits/:habitId/checkins` | dono | |
| GET | `/users/:userId/checkins` | dono ou admin | |

### Rodando localmente

Precisa de Node 24 e uma instância de PostgreSQL.

```bash
git clone https://github.com/IgorCGouveia/LOOP.git
cd LOOP
npm install
```

Cria um arquivo `.env`:

```
DATABASE_URL="postgresql://user:senha@localhost:5432/loop?schema=public"
SECRET_KEY="uma string aleatória com pelo menos 32 caracteres"
```

```bash
npx prisma migrate deploy   # aplica o schema
npm run dev                 # tsx watch, sem passo de build
npm test                    # vitest, roda contra o banco real acima
npm run build && npm start  # build de produção
```

### Licença

[MIT](./LICENSE)
