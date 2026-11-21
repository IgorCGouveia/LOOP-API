# Plano: conteinerizar o LOOP API com Docker

> Proposta, nada disso está no repositório ainda. Os arquivos abaixo
> foram montados e executados (Docker 29.1, Compose 2.40) primeiro no
> commit `b8700bb` e de novo no `e49d0ef` (2026-11-21), depois dos PRs
> #26 a #30: a imagem buildou, as 8 migrations aplicaram num Postgres 16
> limpo, a API respondeu (inclusive `/docs`), e o modo dev recarregou ao
> editar um arquivo.

## Objetivo

1. **Dev local:** `docker compose up` sobe Postgres, aplica as
   migrations e roda a API com hot reload. Ninguém precisa instalar
   Postgres na máquina.
2. **CI:** garantir que a imagem continua buildando a cada PR.
3. **Deploy, se um dia for container:** a produção roda na Vercel desde
   o PR #27. A mesma imagem de runtime roda em qualquer lugar que aceite
   container (Render com Docker, Fly.io, Railway, Cloud Run, uma VM).
   Mudar ou não está em aberto no
   [ADR-0016](../adr/0016-runtime-de-deploy.md). Os itens 1 e 2 valem em
   qualquer resposta.

## Arquivos

```
Dockerfile           multi-stage: deps, dev, build, prod-deps, runtime
.dockerignore
compose.yaml         dev: db + migrate + api (hot reload)
compose.prod.yaml    opcional: simula produção local com a imagem runtime

Já existem e são reaproveitados:
.env.example             o compose lê o .env feito a partir dele (só troca o host do banco)
docker-compose.test.yml  Postgres descartável dos testes (npm run test:db:up)
```

### `Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm-slim AS base
# openssl: o engine do Prisma (engine "classic" em prisma.config.ts) precisa da libssl
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
# tudo a partir daqui roda como "node": o prisma generate escreve em
# node_modules/prisma, e se o npm ci rodar como root o generate do
# stage dev falha com "Can't write to /app/node_modules/prisma"
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 npm ci

# ---------- dev: código entra por bind mount, não por COPY ----------
FROM deps AS dev
ENV NODE_ENV=development
CMD ["sh", "-c", "npx prisma generate && npx tsx watch src/server.ts"]

# ---------- build ----------
FROM deps AS build
# prisma.config.ts usa env("DATABASE_URL"): o generate não conecta no
# banco, mas falha se a variável não existir. Valor falso só pro build.
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY --chown=node:node . .
RUN npm run build

FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# ---------- runtime ----------
FROM base AS runtime
ENV NODE_ENV=production PORT=3333 HOST=0.0.0.0
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build     --chown=node:node /app/dist ./dist
COPY --chown=node:node prisma ./prisma
# src/docs.ts lê ../docs/openapi.yaml quando o app sobe: sem ele, o boot falha
COPY --chown=node:node docs/openapi.yaml ./docs/openapi.yaml
COPY --chown=node:node prisma.config.ts package.json ./
USER node
EXPOSE 3333
# node direto, não "npm start": o npm não repassa SIGTERM direito, e o
# "start" atual roda migrate deploy no boot (ver "Migrations" abaixo)
CMD ["node", "dist/server.js"]
```

### `.dockerignore`

```
node_modules
dist
coverage
src/generated
.env
.env.*
!.env.example
.git
doc-2
```

`docs/` fica de fora do ignore de propósito: o `openapi.yaml` é lido em
tempo de execução.

### `compose.yaml` (dev)

```yaml
name: loop-api

services:
  db:
    image: postgres:16            # mesma versão do CI (.github/workflows/ci.yml)
    environment:
      POSTGRES_USER: loop
      POSTGRES_PASSWORD: loop
      POSTGRES_DB: loop
    ports: ["5432:5432"]          # expor só se quiser abrir com psql/DBeaver do host
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U loop -d loop"]
      interval: 2s
      timeout: 3s
      retries: 20

  migrate:
    build: { context: ., target: dev }
    command: ["sh", "-c", "npx prisma generate && npx prisma migrate deploy"]
    env_file: .env
    environment:
      DATABASE_URL: postgresql://loop:loop@db:5432/loop?schema=public
    volumes: [./src:/app/src, ./prisma:/app/prisma]
    depends_on:
      db: { condition: service_healthy }

  api:
    build: { context: ., target: dev }
    env_file: .env
    environment:
      DATABASE_URL: postgresql://loop:loop@db:5432/loop?schema=public
    ports: ["3333:3333"]
    volumes: [./src:/app/src, ./prisma:/app/prisma, ./docs:/app/docs:ro]
    depends_on:
      migrate: { condition: service_completed_successfully }

volumes:
  pgdata:
```

### `.env`

O `.env.example` da `main` já serve. As credenciais do `DATABASE_URL`
dele (`loop:loop@localhost:5432/loop`) são as mesmas do serviço `db`. O
compose sobrescreve só o host (`db` em vez de `localhost`), então o
mesmo `.env` funciona com e sem Docker. Falta só preencher a
`SECRET_KEY`.

## Comandos do dia a dia

| Tarefa | Comando |
|---|---|
| Subir tudo | `docker compose up` |
| Nova migration | `docker compose run --rm api npx prisma migrate dev --name <nome>` |
| Abrir o banco | `docker compose exec db psql -U loop` |
| Rodar os testes | `npm run test:db:up` e depois `npm test` (o `docker-compose.test.yml` e o `.env.test.example` já existem na `main`) |
| Zerar o banco | `docker compose down -v` |
| Build de produção | `docker compose build` usa BuildKit. `docker build` puro também, desde que o buildx esteja instalado (ver armadilhas). |

## Migrations em produção

Hoje o `npm start` roda `prisma migrate deploy && node dist/server.js`
(`package.json:9`). Em container isso tem três problemas:

1. Com N réplicas subindo juntas, N processos tentam migrar. O Prisma
   usa advisory lock no Postgres, então não corrompe nada, mas o boot de
   todas fica preso esperando a primeira.
2. Uma migration lenta segura o health check, e o orquestrador pode
   matar o container no meio dela.
3. O processo da aplicação precisa de permissão de DDL no banco.

Proposta: rodar a migration como um passo separado, com a **mesma
imagem**, antes de trocar a versão:

```
docker run --rm -e DATABASE_URL=... loop-api:<tag> npx prisma migrate deploy
```

Cada provedor tem um nome para isso: "pre-deploy command" no Render,
`release_command` no Fly.io, job no Cloud Run, `initContainer` ou Job no
Kubernetes. O `start` do `package.json` pode continuar como está para
quem roda sem container.

## Mudanças no código que o plano pede

Pequenas, e entram junto com o Dockerfile:

| Mudança | Por quê |
|---|---|
| Tratar `SIGTERM` em `server.ts`: `server.close()` e depois `prisma.$disconnect()` | `docker stop` esperou os 10 s de timeout e matou o processo. Em deploy, as requisições em andamento caem. |
| `GET /health/live` e `GET /health/ready` (este faz `SELECT 1`) | `HEALTHCHECK` da imagem e health check do provedor |
| `dotenv` em `dependencies` | Hoje ele só vem pelo `c12`, dependência do Prisma. Na imagem de runtime isso funciona por acaso. |
| Mover `tsx` para `devDependencies` | Ele está em `dependencies` e vai para a imagem de produção sem ser usado lá |

Com o health check pronto, a imagem ganha:

```dockerfile
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

## CI

Dois passos novos no `.github/workflows/ci.yml`, depois dos testes:

1. `docker build --target runtime .` para garantir que a imagem continua
   buildando.
2. Se o deploy for container: publicar no GHCR com a tag do commit
   (`ghcr.io/<owner>/loop-api:<sha>`) só em push na `main`.

Os testes continuam rodando fora do container, com o service `postgres`
do Actions. Isso já funciona e é mais rápido.

## Armadilhas encontradas na validação

1. **`src/docs.ts` lê `docs/openapi.yaml` quando o app sobe** (desde o
   PR #30). Uma imagem sem a pasta `docs/` não sobe. Por isso o arquivo
   é copiado no runtime, `docs/` não entra no `.dockerignore`, e o dev
   monta `./docs`.
2. **`prisma generate` exige `DATABASE_URL` no build.** O
   `prisma.config.ts` usa `env("DATABASE_URL")`, que falha com
   `PrismaConfigEnvError` se a variável não existir, mesmo o generate não
   conectando. Solução no Dockerfile: `ARG` com valor falso no stage de
   build. Outra solução seria trocar por
   `process.env.DATABASE_URL ?? ""` no config.
3. **O bind mount de `src/` esconde o client gerado.** O client do
   Prisma é gerado em `src/generated/prisma` (`schema.prisma:3`). Montar
   `./src` por cima do `/app/src` da imagem apaga o client, e a API cai
   com `Cannot find module './generated/prisma/client'`. Por isso o
   stage `dev` roda `prisma generate` ao subir. Mover o `output` para
   fora de `src/` resolveria de vez, mas mexe no build e nos imports.
4. **Container de dev como root cria arquivos de root no host.** O
   generate escreve em `./src/generated` pelo bind mount. Rodando como
   root, a pasta fica com dono root no host e só sai com `sudo`. Por
   isso os stages rodam como `node` (uid 1000, o mesmo do usuário padrão
   na maioria das distros Linux). Só trocar o `USER` no stage `dev` não
   basta: o `npm ci` como root deixa `node_modules` com dono root, e o
   generate falha com `Can't write to /app/node_modules/prisma`. Por
   isso o `chown` e o `USER node` vêm antes do `npm ci`. Se o seu uid
   for outro, use `user: "${UID}:${GID}"` no compose.
5. **`--mount=type=cache` exige BuildKit.** O `docker build` do pacote
   do Ubuntu sem o plugin buildx usa o builder antigo e falha nessa
   linha. O `docker compose build` usa BuildKit. Instale o
   `docker-buildx` ou remova o `--mount`, o que deixa o build mais lento.
6. **Tamanho.** A imagem de runtime ficou com 760 MB. A maior parte é
   o `node_modules` de produção, que inclui o CLI do Prisma (necessário
   para o `migrate deploy` com a mesma imagem) e o `tsx`. Mover o `tsx`
   resolve parte. Uma imagem só para migrations e outra só para runtime
   resolveria o resto, com o custo de manter duas.

## Variáveis de ambiente em produção

| Variável | Onde vem | Observação |
|---|---|---|
| `DATABASE_URL` | secret do provedor | `?connection_limit=N` com várias réplicas (ver revisão de design, C7) |
| `SECRET_KEY` | secret do provedor | o boot valida (`src/config/secretKey.ts`) |
| `CORS_ORIGIN` | config | origem do `loop-web` |
| `NODE_ENV` | imagem (`production`) | liga `secure` e `sameSite=none` no cookie (`src/config/cookies.ts`) |
| `PORT` | provedor ou imagem (`3333`) | Render, Fly e Cloud Run injetam a própria |

Memória mínima do container: 512 MiB, por causa do Argon2 (64 MiB por
hash, até 4 em paralelo). Ver a revisão de design, C10.
