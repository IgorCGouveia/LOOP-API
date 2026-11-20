# ADR-0003: Onde hospedar a API e como ela sobe

- **Status:** Aceito (opção A, entrypoint por adapter manual)
- **Data:** 2026-11-20
- **Decisor:** decisão delegada pelo dono do projeto em 2026-11-20. Pendente de revisão.
- **Relacionado:** [ADR-0004](./0004-migrations-no-build-de-producao.md), [ADR-0005](./0005-conexao-pooled-e-direta-no-neon.md), [ADR-0006](./0006-rate-limit-em-memoria-no-serverless.md), [ADR-0007](./0007-cookie-de-refresh-via-rewrite-no-front.md), [guia de deploy](../guides/deploy-vercel.md)

## Contexto

A API rodava no Render como processo longo: `src/server.ts` chama
`server.listen()`, e o script `start` roda `prisma migrate deploy` antes
de subir (`package.json:10`). O banco foi para o Neon (Postgres
serverless, `us-east-1`). O primeiro destino tentado foi o Koyeb, mas o
painel dele ficou lento demais para usar. O front (`loop-web`, outro
repositório) vai para a Vercel.

Restrições:
- Tem que ser grátis.
- `src/app.ts` exporta `buildApp()` sem chamar `listen()` e sem export
  default. O `listen()` fica em `src/server.ts:20`.
- O `argon2` é um addon nativo, e o Prisma usa engine binário com saída
  customizada em `src/generated/prisma` (`prisma/schema.prisma:3`).

## Opções consideradas

### Opção A: API na Vercel como função serverless
- Ganha: front e API no mesmo provedor, num painel só. Abre caminho para
  o rewrite do [ADR-0007](./0007-cookie-de-refresh-via-rewrite-no-front.md).
- Perde: não existe mais etapa de `start`, então as migrations precisam de
  outro lugar (ADR-0004). Estado em memória deixa de ser global (ADR-0006).
  Cada instância abre a própria conexão com o banco (ADR-0005).

### Opção B: só o front na Vercel, API sem mudanças em outro host
(Koyeb pela CLI, Google Cloud Run)
- Ganha: zero mudança na API.
- Perde: dois provedores. O Cloud Run exige cartão e Dockerfile.

### Opção C: VM sempre ligada (Oracle Cloud Always Free)
- Ganha: sem cold start, estado em memória continua global.
- Perde: administrar servidor (HTTPS, updates, systemd).

Para a opção A havia dois entrypoints possíveis:
- **Detecção automática de Fastify pela Vercel.** Ela procura, em ordem,
  `src/app.*`, `src/index.*`, `src/server.*`... O primeiro achado seria
  `src/app.ts`, que não sobe servidor nem exporta a app. A documentação
  não diz como a Vercel trata esse caso.
- **Adapter manual em `api/index.js`.** Mais código, mas o comportamento
  é conhecido.

## Decisão

Opção A, com adapter manual. O dono do projeto escolheu a Vercel para a
API. O adapter foi escolhido porque a detecção automática pegaria o
arquivo errado (`src/app.ts`).

Implementação:
- `api/index.js:19-22`: o handler repassa o request para
  `app.server.emit("request", ...)`. A instância do Fastify fica no
  escopo do módulo (`api/index.js:16-17`) e é reaproveitada entre
  invocações da mesma instância.
- `api/index.js:9-10`: é JS puro e importa de `dist/`, compilado pelo
  `npm run build`. Assim não depende de como a Vercel compila TS com o
  `rootDir: "src"` do `tsconfig.json`.
- `api/index.js:14`: repete o guard da `SECRET_KEY` do `server.ts`.
- `vercel.json`: `framework: null` (desliga a detecção automática),
  `buildCommand: npm run vercel-build` e rewrite de tudo para `/api`.
  O `outputDirectory: "public"` aponta para uma pasta vazia criada no
  build (`package.json:11`). Sem isso, o preset "Other" serviria a raiz
  do repositório como arquivos estáticos (`package.json`, schema etc.).
- `package.json:13`: `engines.node: 24.x`, igual ao CI.

Conferido sobre o commit `b8700bb` mais as mudanças da branch `IgorCGouveia/Deploy`.

## Consequências

- `src/server.ts` e o script `start` continuam valendo para rodar local e
  para qualquer host de processo longo. Não foram removidos.
- **Não verificado antes do primeiro deploy:** se o empacotamento da
  Vercel inclui o binário nativo do `argon2` e o engine do Prisma em
  `dist/generated/prisma` (fora do `node_modules`). Se falhar, o erro
  aparece nos logs da função na primeira chamada que toca o banco ou o
  hash de senha. A correção esperada é `functions.includeFiles` no
  `vercel.json`.
- Cold start de função mais o cold start do Neon na primeira request
  depois de um período parado.
- Limite de corpo de request/resposta de 4,5 MB (a API não chega perto).
