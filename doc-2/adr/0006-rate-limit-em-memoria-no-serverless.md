# ADR-0006: Rate limit e delay de login continuam em memória no serverless

- **Status:** Aceito (opção A, risco aceito temporariamente)
- **Data:** 2026-11-20
- **Decisor:** decisão delegada pelo dono do projeto em 2026-11-20. Pendente de revisão.
- **Relacionado:** [ADR-0003](./0003-hospedar-api-na-vercel.md)

## Contexto

Há duas camadas de proteção, e as duas guardam estado na memória do
processo:
- Camada de IP: `@fastify/rate-limit` com store padrão, registrado em
  `src/Middleware/rateLimit.ts:16`. Cadastro limitado a 5 por hora
  (`src/routes/UserRoute.ts:13`) e login a 20 por minuto
  (`src/routes/indexRoute.ts:13`).
- Camada de conta: `attemptTracker`, com delay progressivo por email
  num `Map` (`src/services/attemptTracker.ts:1-3`), usado em
  `src/controllers/indexController.ts:21-42`.

No Render havia uma instância só, e a memória valia como estado global.
Na Vercel (ADR-0003), cada instância da função tem a própria memória, e
as instâncias são criadas e recicladas conforme a carga.

## Opções consideradas

### Opção A: manter em memória
- Ganha: nenhuma mudança, nenhuma dependência.
- Perde: os limites valem por instância e zeram quando ela é reciclada.
  Um atacante distribuído entre instâncias ou esperando uma reciclagem
  consegue mais tentativas que o limite.

### Opção B: estado no Postgres
- Ganha: estado global, sem serviço novo.
- Perde: precisa de migration (tabela de tentativas) e de uma query a
  mais em todo login.

### Opção C: Upstash Redis (store do `@fastify/rate-limit`)
- Ganha: é a solução feita para isso, com free tier.
- Perde: dependência nova e mais um serviço externo.

## Decisão

Opção A, por enquanto. As opções B e C exigem migration ou dependência
nova, e o protocolo do projeto pede aprovação explícita para as duas.
Isso não cabia no escopo do primeiro deploy.

## Consequências

- **Risco aceito:** a proteção contra força bruta fica mais fraca do que
  os números configurados sugerem. O custo do Argon2id em cada tentativa
  continua sendo uma barreira.
- O IP que a camada de IP enxerga depende do `X-Forwarded-For`
  (`trustProxy: true`, `src/app.ts`). A Vercel preenche esse header com o
  IP do cliente, mas quando a request chega pelo rewrite do front
  (ADR-0007) ainda não foi verificado se o IP é o do usuário ou o da
  borda da Vercel. Se for o da borda, todos os usuários dividem o mesmo
  contador.
- Revisitar quando houver usuários reais ou sinais de abuso. O caminho
  previsto é a opção B ou C, com novo ADR substituindo este.
