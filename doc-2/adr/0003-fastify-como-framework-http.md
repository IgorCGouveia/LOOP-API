# ADR-0003: Fastify como framework HTTP

- **Status:** Aceito (retroativo)
- **Data:** 2026-11-20 (decisão original: 2026-05-20, commit `68cb140`)
- **Decisor:** dono do projeto
- **Relacionado:** [ADR-0004](./0004-prisma-como-orm.md), [ADR-0006](./0006-autenticacao-jwt-e-refresh-em-cookie.md), [ADR-0007](./0007-desenho-das-rotas-usuarios-e-habitos.md)

> **ADR retroativo.** A decisão foi tomada no primeiro commit do projeto.
> O raciocínio da época ficava no `DECISIONS.md`, que foi removido do
> histórico (ver [ADR-0001](./0001-registrar-decisoes-com-adr.md)). O
> contexto abaixo foi reconstruído a partir do código no commit `b8700bb`.
> Onde o motivo é inferido e não registrado, o texto diz isso.

## Contexto

- O LOOP é uma API REST sem frontend. O contrato HTTP é o produto
  (`README.md`, seção *Overview*).
- O `fastify@^5.8.5` já está no `package.json` do primeiro commit
  (`68cb140`), junto só com o `tsx`. Nunca houve outro framework no
  histórico.
- O projeto é em TypeScript estrito e usa Zod para validar entrada
  (`src/schema/*.ts`).
- Os testes de integração sobem a app com `buildApp()` e chamam
  `app.inject()`, sem abrir porta (`src/app.ts`, `src/__tests__/setup.ts`).
- O que o projeto usa do ecossistema do framework hoje:
  - `preHandler` por rota para autenticação (`src/routes/*.ts`).
  - Plugins oficiais: `@fastify/cookie`, `@fastify/cors`,
    `@fastify/rate-limit` (`src/app.ts:27-30`).
  - `config.rateLimit` por rota (`src/routes/indexRoute.ts`,
    `src/routes/UserRoute.ts`).
  - `setErrorHandler` central (`src/app.ts:35`,
    `src/Middleware/errorHandler.ts`).
  - Logger embutido (pino) com `reqId`, que volta no corpo dos `500` e
    `429`.
  - `trustProxy: true` para o rate limit ver o IP real atrás do proxy
    (`src/app.ts:24-26`).

## Opções consideradas

| | Express | Fastify | NestJS | Hono |
|---|---|---|---|---|
| Complexidade inicial | Baixa | Baixa | Alta (módulos, DI, decorators) | Baixa |
| Plugins oficiais (cookie, CORS, rate limit) | Pacotes de terceiros | Mantidos pelo próprio projeto | Via adapters | Middlewares embutidos |
| Teste sem abrir porta | Precisa do `supertest` | `inject()` nativo | `supertest` ou `inject()` (adapter Fastify) | `app.request()` nativo |
| Tipagem de request | Fraca, precisa de augmentation | Boa, com generics e declaration merging | Boa | Boa |
| Logger estruturado | Não vem | pino embutido | Logger próprio | Não vem |

### Opção A: Express
- O framework Node mais conhecido, com mais material e exemplos.
- Ganha: qualquer pessoa que chega ao projeto já conhece.
- Perde: async/await só tratado de verdade a partir do Express 5. Sem
  logger nem `inject()` embutidos. Cookie, CORS e rate limit viriam de
  pacotes de terceiros.

### Opção B: Fastify (escolhida)
- Plugins encapsulados, hooks por rota (`preHandler`), `inject()` e pino
  embutidos.
- Ganha: tudo o que a lista do contexto usa vem do próprio projeto
  Fastify. O `inject()` é a base da estratégia de testes.
- Perde: comunidade menor que a do Express. O modelo de encapsulamento de
  plugins tem regras próprias que pegam quem vem do Express (ver
  *Consequências*).

### Opção C: NestJS
- Framework com opinião forte: módulos, injeção de dependência,
  decorators, guards.
- Ganha: estrutura pronta para times grandes. Guards resolveriam a
  autorização de forma declarativa.
- Perde: muita cerimônia para uma API com cerca de 17 rotas. Esconde o
  funcionamento do HTTP, o que vai contra um projeto de portfólio que
  quer mostrar esse funcionamento.

### Opção D: Hono
- Framework leve, feito para rodar em vários runtimes (Node, Bun, edge).
- Ganha: roda igual em serverless e edge.
- Perde: ecossistema de plugins menor. Em maio de 2026 o deploy previsto
  era um processo Node longo no Render, então portabilidade de runtime
  não era requisito.

## Decisão

**Fastify**, desde o primeiro commit.

O motivo original não ficou registrado. O que o código mostra é que o
projeto depende de quatro recursos que o Fastify entrega sem pacote de
terceiros: `inject()` para os testes de integração, `preHandler` por rota
para auth, `config` por rota para rate limit e o logger com `reqId`.

## Consequências

- **Mais fácil:** testar a API inteira contra um Postgres real sem subir
  servidor. A suíte em `src/__tests__/` depende disso.
- **Mais fácil:** ligar um recurso numa rota só. O rate limit é
  `global: false` e cada rota opta (`src/Middleware/rateLimit.ts`).
- **Mais difícil:** o encapsulamento de plugins. Um plugin registrado sem
  `fastify-plugin` só vale dentro do próprio escopo. Hoje os plugins de
  infraestrutura são registrados direto na instância raiz em `buildApp()`,
  antes das rotas, e por isso valem para todas. Mudar essa ordem quebra o
  CORS ou o rate limit sem erro visível.
- **Mais difícil:** o controller é uma classe com métodos passados soltos
  para o Fastify. Quem usa `this` precisa de arrow function, como em
  `Auth.admin` (`src/Middleware/Auth.ts:61-63`).
- **A acompanhar:** a validação é feita com Zod dentro dos controllers, e
  não com o `schema` de rota do Fastify. Por isso a API não tem
  serialização acelerada nem geração automática de OpenAPI. Mudar isso é
  uma decisão própria.
- **A acompanhar:** desde o #27 (`b19483c`) a produção roda como função
  serverless na Vercel. O Fastify continua, mas o boot em produção passa
  por `api/index.ts`, que repassa o request para `app.server` sem chamar
  `listen()`. O `src/server.ts` ficou para dev local e hosts com processo
  longo. A escolha da Vercel ainda não tem ADR próprio.
