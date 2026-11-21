# ADR-0011: Autenticação com JWT curto e refresh token opaco em cookie

- **Status:** Aceito (retroativo)
- **Data:** 2026-11-20 (decisões originais: login e JWT em 2026-07-03, commit `65571f8`; rate limit em 2026-09-10, `150ce62`; refresh token em 2026-09-12, migration `20260912222917_add_refresh_token`)
- **Decisor:** dono do projeto
- **Relacionado:** [ADR-0008](./0008-fastify-como-framework-http.md), [ADR-0012](./0012-desenho-das-rotas-usuarios-e-habitos.md), ADR-0006 e ADR-0007 no branch `IgorCGouveia/Deploy`

> **ADR retroativo.** Parte do raciocínio ficava no `DECISIONS.md`
> removido; os comentários no código ainda apontam para ele
> (`src/controllers/indexController.ts`, `src/config/cookies.ts`). O
> contexto abaixo foi reconstruído a partir do código no commit `b8700bb`
> e desses comentários.

## Contexto

Dois clientes, com necessidades diferentes:
- **Mobile** (stack ainda não escolhida). Não sofre CORS e pode guardar
  segredo no armazenamento seguro do sistema
  (`docs/API-REFERENCE.md`, seção de contexto do cliente).
- **`loop-web`**, em outro domínio. Tudo que o JavaScript consegue ler
  fica exposto a XSS.

Como funciona hoje:
1. `POST /login` confere a senha com Argon2id. Se o e-mail não existe,
   verifica contra um hash descartável para o tempo de resposta ser igual
   ao de senha errada (`src/services/indexService.ts:8`).
2. A resposta traz um **access token** JWT HS256 com `{ id, role }`,
   validade de 1 hora (`indexService.ts:22`), no corpo.
3. Na mesma resposta, a API grava um **refresh token** num cookie
   `httpOnly`. É um valor aleatório de 32 bytes
   (`src/utils/token.ts`). O banco guarda só o sha256 dele, com validade
   de 7 dias (`src/services/refreshTokenServices.ts:6`) e `revokedAt`.
4. Rotas protegidas recebem `Authorization: Bearer <token>`.
   `Auth.user` só confere a assinatura e a validade e coloca `req.user`
   (`src/Middleware/Auth.ts:47`). Não consulta o banco. `Auth.admin`
   exige também `role = "ADMIN"` (`Auth.ts:67`).
5. `POST /refresh` lê o cookie e devolve um access token novo. O mesmo
   refresh token continua valendo (sem rotação).
6. `POST /logout` marca `revokedAt` e limpa o cookie.
7. Contra força bruta no login: rate limit por IP (20/min,
   `src/routes/indexRoute.ts`) e atraso progressivo por e-mail, igual em
   sucesso e falha, sem bloquear a conta (`src/services/attemptTracker.ts`).
8. O boot falha se a `SECRET_KEY` estiver ausente, curta ou for um valor
   de exemplo (`src/config/secretKey.ts`, `src/server.ts`).

O cookie usa `sameSite: "none"` e `secure: true` em produção, porque
front e API ficam em domínios diferentes (`src/config/cookies.ts`). O
CORS libera só origens explícitas, com `credentials: true`
(`src/Middleware/cors.ts`).

## Opções consideradas

| | A. Sessão no servidor | B. JWT curto + refresh opaco sem rotação | C. Igual a B, com rotação | D. Provedor externo |
|---|---|---|---|---|
| Consulta ao banco por request | Sim | Não | Não | Depende |
| Revogar acesso na hora | Sim | Só o refresh; o access vale até 1h | Igual a B | Depende |
| Funciona igual em mobile e web | Cookie no mobile é desconfortável | Sim, o refresh fica opcional | Sim | Sim |
| Complexidade | Baixa | Média | Alta (detecção de reuso, corrida entre abas) | Baixa no código, alta na integração |
| Custo | Nenhum | Nenhum | Nenhum | Plano pago a partir de certo volume |

### Opção A: sessão no servidor
- Cookie com id de sessão, tabela de sessões, consulta a cada request.
- Ganha: logout e troca de papel valem na hora. Nada sensível no cliente.
- Perde: uma consulta ao banco por request. No mobile, cookie é menos
  natural que header. Precisa de proteção a CSRF em todas as rotas que
  mudam estado.

### Opção B: JWT curto no header, refresh opaco em cookie, sem rotação (escolhida)
- Ganha: o access token é verificado sem banco. O mobile usa só o access
  token, e o refresh existe só para o web. O refresh no banco permite
  logout de verdade. O cookie `httpOnly` deixa o refresh fora do alcance
  de XSS.
- Perde: sem rotação, um refresh token roubado vale por até 7 dias, ou
  até o logout. O access token não pode ser revogado antes de expirar.

### Opção C: igual a B, com rotação do refresh
- Cada `/refresh` invalida o token usado e emite outro. Reuso de token
  antigo revoga a família inteira.
- Ganha: um token roubado é detectado no primeiro uso concorrente.
- Perde: duas abas fazendo refresh ao mesmo tempo derrubam a sessão sem
  tratamento extra (janela de tolerância ou trava). Mais estado no banco.

### Opção D: provedor externo (Auth0, Clerk, Supabase Auth, Neon Auth)
- Ganha: MFA, login social e recuperação de senha prontos.
- Perde: dependência de terceiro e custo. Esconde justamente a parte que
  um projeto de portfólio quer mostrar.

## Decisão

**Opção B.** JWT HS256 de 1 hora no header `Authorization` para os dois
clientes. Refresh token opaco de 7 dias, guardado como hash, em cookie
`httpOnly`, só para o `loop-web`, sem rotação. Senha com Argon2id. Login
protegido por rate limit de IP mais atraso progressivo por conta.

Motivos que o próprio código registra:
- **Refresh sem rotação** é um trade-off declarado como explícito
  (`src/controllers/indexController.ts`, método `refresh`).
- **Refresh só no web**, porque nenhum cliente mobile existia
  (`indexController.ts`, método `login`).
- **sha256 e não Argon2** para o refresh, porque 256 bits aleatórios já
  são inviáveis de adivinhar (`src/utils/token.ts`).
- **7 dias** é o padrão de mercado, sem requisito de produto que peça
  outro valor (`refreshTokenServices.ts:4-5`).
- **Atraso e não bloqueio** no login, porque bloquear a conta vira uma
  forma de negar acesso ao dono (`attemptTracker.ts:1-3`).

## Consequências

- **Mais fácil:** escalar leitura. Nenhuma rota protegida consulta o banco
  para autenticar.
- **Mais fácil:** adicionar o mobile. Ele usa o mesmo login e ignora o
  cookie.
- **Mais difícil, aceito:** o papel fica congelado no token por até 1
  hora. Rebaixar um admin, ou apagar um usuário, não derruba o access
  token já emitido. O teste de ownership forja um JWT de admin para um id
  que não existe no banco, e o middleware aceita
  (`src/__tests__/ownership.test.ts:55-58`).
- **Mais difícil, aceito:** um refresh token vazado vale até expirar ou
  até o logout. A única defesa é o `httpOnly`.
- **Mais difícil:** o `sameSite: "none"` deixa o navegador mandar o cookie
  em qualquer request cross-site. O `/refresh` não vaza o token, porque o
  CORS impede outra origem de ler a resposta. Mas um site qualquer
  consegue disparar `POST /logout` e encerrar a sessão do usuário.
- **A acompanhar:** o `attemptTracker` guarda o estado em memória, numa
  instância só. Com várias instâncias (serverless), cada uma conta
  sozinha. O ADR-0006 do branch `IgorCGouveia/Deploy` trata disso.
- **A acompanhar:** com front e API em `*.vercel.app` diferentes, o cookie
  vira de terceiros e o Safari bloqueia. O ADR-0007 do mesmo branch
  resolve com rewrite no front.
- **A acompanhar:** `Auth.user` pega a segunda parte do header
  (`bearer.split(" ")[1]`, `Auth.ts:30`) sem conferir se o esquema é
  `Bearer`. Funciona, mas aceita qualquer prefixo.
- **Não coberto:** recuperação de senha, verificação de e-mail, MFA e
  promoção de usuário a admin pela API. Cada um, se vier, pede ADR
  próprio.
