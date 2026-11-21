# ADR-0016: A API continua como função serverless na Vercel ou passa para container?

- **Status:** Proposto
- **Data:** 2026-11-20 (contexto revisto em 2026-11-21, depois do PR #27)
- **Decisor:** dono do projeto
- **Relacionado:** [plano de Docker](../proposals/containerizacao-docker.md), [revisão de design](../proposals/design-review-2026-11-20.md#53-rodar-mais-de-uma-instância), PR #27, PR #25 (fechado)

## Contexto

Conferido no commit `e49d0ef`.

A API roda em produção na Vercel desde o PR #27 (commit `b19483c`), como
Function serverless (`api/index.ts`), com o banco no Neon
([visão geral](../architecture/overview.md)). As migrations rodam no
build de produção (`scripts/vercel-migrate.mjs`, chamado pelo
`vercel-build` em `package.json`), pela conexão direta, porque o pooler
do Neon não aceita o advisory lock do `migrate`.

Essa escolha não tem ADR na `main`. Os ADRs de deploy foram escritos no
PR #25, que foi fechado sem merge, e o #27 entrou sem eles. Este ADR
registra a pergunta que o pedido de conteinerização levanta: manter o
serverless ou mudar o runtime de produção para container. Se a escolha
for manter a Vercel, este ADR também serve como o registro que falta.

Fatos do código que pesam na escolha:

- Estado em memória: rate limit por IP e `attemptTracker`
  (`src/services/attemptTracker.ts`). Na Vercel, cada instância tem o
  próprio contador, e uma instância nova começa do zero. Em container
  com uma réplica, funciona como num servidor só. Com várias réplicas,
  os dois casos precisam de Redis.
- O `attemptTracker` tem um `setInterval` de limpeza e o login usa
  `sleep` no delay progressivo. Os dois foram pensados para processo
  longo. Numa função, o tempo do `sleep` é tempo de execução cobrado.
- Argon2 usa 64 MiB por hash e threads nativas.
- `api/index.ts` monta o app no escopo do módulo, e com Fluid compute a
  mesma instância atende várias requisições. O cold start inclui o
  Prisma e o Argon2.
- `src/server.ts` continua sendo o entrypoint de dev e de qualquer host
  com processo longo. O `npm start` (`migrate deploy` + `node
  dist/server.js`) também continua.
- O Dockerfile do [plano](../proposals/containerizacao-docker.md) serve
  para dev local e CI em qualquer opção.

## Opções consideradas

### Opção A: manter a Vercel (serverless) em produção
- Muda no código: nada. O Docker entra só para dev e CI.
- Ganha: zero infra para operar. Escala a zero, cobra por uso. Preview por PR. Já está no ar e testado.
- Perde: a proteção do login (rate limit e delay por email) vale por instância. Cold start com Prisma e Argon2. Limites de memória e duração da plataforma. Dev (processo longo, `server.ts`) e produção (Function, `api/index.ts`) rodam por caminhos diferentes.

### Opção B: container em PaaS (Render com Docker, Fly.io, Railway, Cloud Run)
- Muda no código: `SIGTERM`, `/health/*` e migration como passo separado (ver o plano). Sai o `vercel.json` e o `api/index.ts`, ou eles ficam parados.
- Ganha: o mesmo artefato em dev, CI e produção. Com uma réplica, o estado em memória funciona inteiro. Sem limite de duração de requisição. Portável entre provedores.
- Perde: paga por tempo ligado, exceto Cloud Run e Fly com escala a zero, que têm cold start de container. Mais coisa para operar: imagem, registry, tamanho. Desfaz um deploy que acabou de entrar.

### Opção C: Vercel agora, container quando um gatilho aparecer
- Gatilhos possíveis: abuso no login que o limite por instância não segura, cold start acima da meta de latência, custo da Vercel acima do de uma instância fixa.
- Ganha: não mexe no que está funcionando. A decisão fica atrelada a um sinal medido.
- Perde: precisa de alguém olhando esses sinais. Enquanto isso, o risco do login por instância continua aceito.

## Decisão

<Pendente.>

## Consequências

<Preencher quando aceito.>
