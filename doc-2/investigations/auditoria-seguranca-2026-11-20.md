# Investigação: auditoria de segurança da API

- **Conferido no commit:** `b8700bb` (branch `main`). Revalidado em
  `b19483c` (PR #27, deploy na Vercel), que não muda nada em `src/`. As
  citações de arquivo:linha dos achados valem para esse commit.
- **Situação atualizada em:** `e49d0ef` (ver
  [Situação em `e49d0ef`](#situação-em-e49d0ef))
- **Data:** 2026-11-20, revisado em 2026-11-21
- **Escopo:** autenticação e autorização, validação de entrada, segredos e
  variáveis de ambiente, tratamento de erros, dependências e CI
- **Produção:** Vercel (projeto `loop-api`, entrypoint `api/index.ts`),
  com o front (`loop-web`) fazendo rewrite de `/api/*` para a API
- **Status:** M1, M4, L2 e L3 já corrigidos na `main`; H2 corrigido na
  branch `IgorCGouveia/security-h1-h2`; os demais abertos. Decisões
  abertas: [ADR-0013](../adr/0013-como-a-api-descobre-o-ip-do-cliente.md),
  [ADR-0014](../adr/0014-reautenticacao-para-trocar-senha-ou-email.md),
  [ADR-0015](../adr/0015-limites-para-rotas-autenticadas.md)

## Resumo

Um usuário **não consegue** ler nem alterar hábitos ou check-ins de
outro. Todos os handlers conferem o dono do recurso antes de agir, o
`userId` vem do token e nunca do body, e não há SQL escrito à mão.

Os problemas sérios estão em volta desse núcleo:

- `fastify` e `zod` de produção têm vulnerabilidades publicadas com
  correção disponível sem mudar de versão major (H2);
- quem rouba um access token troca senha e email da vítima, e trocar a
  senha não derruba sessões antigas (H3).

O H1 (IP forjável pelo `X-Forwarded-For`) foi confirmado no código e em
teste local. Na produção atual (Vercel), uma medição mostrou que ele
**não é explorável**, porque a Vercel sobrescreve o header. Ele continua
registrado porque volta a valer em qualquer hospedagem que só acrescente
IPs ao header.

## Situação em `e49d0ef`

Depois da auditoria, outros PRs entraram na `main` e corrigiram parte
dos achados. A tabela foi conferida no commit `e49d0ef` (2026-11-21):
leitura do código e o mesmo teste com `app.inject` da seção
[Como foi verificado](#como-foi-verificado).

| ID | Situação | Evidência em `e49d0ef` |
|---|---|---|
| H1 | Aberto, não explorável na Vercel | `src/app.ts:21` ainda tem `trustProxy: true`. Localmente, `X-Forwarded-For` forjado ainda vira `req.ip`. Decisão: [ADR-0013](../adr/0013-como-a-api-descobre-o-ip-do-cliente.md) |
| H2 | Corrigido na branch `IgorCGouveia/security-h1-h2` | `fastify` 5.12.8, `zod` 4.6.7, `fast-uri` 3.1.9, `ip-address` 10.7.6. Sobram 4 advisories que dependem do `prisma` 7 |
| H3 | Aberto | `UserController.ts:45-52` e `userServices.ts:47-67` iguais. Decisão: [ADR-0014](../adr/0014-reautenticacao-para-trocar-senha-ou-email.md) |
| M1 | **Corrigido** em `e49d0ef` (PR #28) | `errorHandler.ts:34-77` respeita o `statusCode` 4xx. Teste: JSON malformado responde 400, body grande 413, 21º `/login` 429 |
| M2 | Aberto | `indexController.ts:14` sem schema. Teste: body ausente e `email: {}` ainda respondem 500 |
| M3 | Aberto | `habitVal.ts:13` e `userVal.ts:12,16` sem mudança. `HabitController.ts:12` ainda faz `req.body as` |
| M4 | **Corrigido** em `e49d0ef` (PR #28) | `checkinAccess.test.ts` e `ownership.test.ts:164-177` testam o 403 nas rotas de check-in. A checagem agora fica num lugar só: `Middleware/habitAccess.ts` (PR #17, ADR-0011) |
| M5 | Aberto | `.github/workflows/ci.yml` sem `permissions:`, `npm audit` ou `gitleaks`. Actions por tag. Sem `dependabot.yml` |
| M6 | Aberto | Sem limite por usuário. Listagens em `habitServices.ts:64-88` e `checkinRepository.ts:46-58` sem paginação. Decisão: [ADR-0015](../adr/0015-limites-para-rotas-autenticadas.md) |
| L1 | Aberto | `indexService.ts:8-9`, `DUMMY_HASH` ainda com `p=4` |
| L2 | **Corrigido** em `e49d0ef` (PR #28) | `Auth.ts:17-24,63-73`: algoritmo fixo em HS256 e payload validado com Zod. O `role` em token de conta apagada ou rebaixada está no [ADR-0012](../adr/0012-sessao-de-usuario-apagado.md) |
| L3 | **Corrigido** em `f6129dd` (PR #18) | `errorHandler.ts:13-24` escolhe a mensagem pela constraint |
| L4 | Aberto | `Middleware/habitAccess.ts:39-48` e `UserController.ts:39-45` ainda respondem 404 antes de 403 |
| L5 | Aberto | Igual. O deploy na Vercel (PR #27) torna o estado por instância real |
| L6 | Aberto | `tsx` continua em `dependencies` |
| L7 | Aberto | Sem mudança |

## Como cada ponto é classificado

Cada achado tem um ID estável (`H1`, `M3`, `L2`) para ser citado no PR,
no commit e no CHANGELOG da correção. A severidade combina impacto,
probabilidade e exposição:

| Severidade | Significado |
|---|---|
| **HIGH** | Grave, mas depende de uma pré-condição (token roubado, por exemplo), ou é exploração fácil de um controle importante |
| **MEDIUM** | Fraqueza real com dano limitado, ou um controle crítico que nenhum teste confirma |
| **LOW** | Menor, ou adiável. Cada um diz o que o faria subir de nível |

Cada achado segue o mesmo formato: **onde** (arquivo:linha), **o que
acontece**, **impacto**, **solução proposta** e **teste que prova a
correção**. Quando a solução tem trade-off que cabe ao dono do projeto
decidir, ela aponta para um ADR `Proposto` em vez de recomendar uma
opção.

## Como foi verificado

As afirmações abaixo vêm de comandos executados, não da leitura da doc.
Os testes de comportamento rodaram numa cópia isolada do repositório com
`app.inject` do Fastify, sem banco.

| Verificação | Resultado |
|---|---|
| Leitura de todo `src/` (fora testes), `prisma/schema.prisma`, CI, `.gitignore` | feita |
| `npm audit --omit=dev` | 8 vulnerabilidades em produção: 7 high, 1 moderate |
| `.env` já foi commitado? (`git log --all --diff-filter=A -- '.env*'`) | Não. Só `.env.test.example` |
| SQL escrito à mão (`git grep 'queryRaw\|executeRaw'`) | Nenhuma ocorrência |
| Proteção da `main` (`gh api repos/.../branches/main/protection`) | Exige o check `test`, com `strict` |
| `tsc --noEmit` | Sem erros |
| Suíte do vitest | **Não executada**: precisa de Postgres |

Saída dos testes com `app.inject`:

```
X-Forwarded-For forjado                 -> req.ip visto pela app = 6.6.6.6 (valor do atacante)
22º POST /login do mesmo IP             -> 500 (deveria ser 429)
25º POST /login trocando o XFF          -> 400 (passou pelo limite)
JSON malformado / sem body / content-type não suportado / body > 1 MB -> 500
POST /login com email como objeto       -> 500
token com alg=none / assinado com outra chave -> 401 (correto)
argon2.verify, mediana de 15 execuções: DUMMY_HASH (p=4) 91 ms, hash real (p=1) 123 ms
```

## Achados

### HIGH

#### H1. `trustProxy: true` deixa o cliente escolher o próprio IP

> **Revisão de 2026-11-21: não explorável na produção atual.** A
> classificação HIGH vale para hospedagens que acrescentam IPs ao
> `X-Forwarded-For` (Render, Nginx, `src/server.ts` atrás de qualquer
> proxy). Na Vercel, o achado fica latente. O ID continua H1 para manter
> o histórico. Medição em produção (deploy `dpl_AXXPokxAsfvK2Zds7nex8daSBYfT`,
> commit `b19483c`):
>
> | Request | `X-Forwarded-For` enviado | `remoteAddress` no log da API |
> |---|---|---|
> | Direto em `loop-api-jade.vercel.app/login` | `203.0.113.77` | IP real do cliente |
> | Direto, com dois IPs | `203.0.113.77, 198.51.100.9` | IP real do cliente |
> | Pelo rewrite `loop-web-eosin.vercel.app/api/login` (duas vezes) | `203.0.113.88` | IP real do cliente |
>
> O IP real foi conferido com `api.ipify.org`. Isso bate com a
> documentação da Vercel: ela sobrescreve o `X-Forwarded-For` e não
> repassa IPs vindos de fora. A medição também responde uma dúvida do
> deploy: **o rewrite do front preserva o IP do usuário**, então os
> usuários não dividem o mesmo contador.

**Onde:** `src/app.ts:26`

```ts
const server = Fastify({logger: true, trustProxy: true});
```

**O que acontece:** com `true`, o Fastify confia em todos os proxies da
cadeia e usa como `req.ip` o endereço mais à esquerda do
`X-Forwarded-For`. Esse endereço é escrito pelo cliente. O proxy da
hospedagem só acrescenta o IP real à direita. O comentário logo acima
diz "Render é hop único de proxy", mas a configuração não diz isso ao
Fastify.

**Impacto:** o rate limit por IP do `/login` (20/min,
`src/routes/indexRoute.ts:13`) e do cadastro (5/h,
`src/routes/UserRoute.ts:13`) deixa de funcionar. Basta trocar o header a
cada request (verificado acima). O delay progressivo do
`attemptTracker` continua valendo, mas ele é por email. Quem testa uma
senha comum contra muitos emails (*password spraying*) não é freado, e
o cadastro em massa também fica livre.

**Solução proposta:** confiar só no número de proxies que a hospedagem
realmente tem, ou ler o header que o provedor garante. Qual dos dois
depende de onde a API roda, e o branch de deploy está trocando Render
por Vercel. Por isso a escolha está no
[ADR-0013](../adr/0013-como-a-api-descobre-o-ip-do-cliente.md). Qualquer
opção precisa vir junto com o H2, porque o `fastify` 5.8.5 tem uma falha
própria nesse mesmo recurso (GHSA-3m5p-2c4r-xxw2: falsificação de
`X-Forwarded-*` com `trustProxy` por contagem de hops).

**Teste que prova:** com `app.inject`, 25 requests ao `/login` com
`remoteAddress` fixo e `X-Forwarded-For` diferente em cada uma. A partir
da 21ª, a resposta tem que ser 429.

#### H2. Dependências de produção com vulnerabilidades publicadas

**Onde:** `package-lock.json`

| Pacote | Versão | Advisories | Corrige em |
|---|---|---|---|
| `fastify` | 5.8.5 | 7 (4 high): troca do body da request, bypass de validação de schema e de header, bypass de auth via URL malformada em not-found handler encapsulado, falsificação de XFF | `>= 5.12.5` |
| `zod` | 4.4.3 | GHSA-mrhx-c7xc-m3w5: estouro de memória ao validar coleções grandes | `>= 4.6.6` |
| `fast-uri` | 3.1.5 | 10, transitivo do fastify | sobe junto com o fastify |
| `ip-address` | transitivo | 3 moderate | sobe junto |
| `effect`, `deepmerge-ts` | transitivos do `prisma` | ReDoS e estouro de pilha | só no `prisma` 7 (major) |

**Impacto:** o bypass de auth via not-found handler provavelmente não se
aplica, porque o projeto não registra not-found handler próprio e a auth
é `preHandler` por rota. Os outros afetam qualquer app Fastify. O
advisory do `zod` tem um caminho real aqui: `daysOfWeek` é um array sem
limite de tamanho (ver M3).

**Solução proposta:**
1. Num PR: `fastify` para `^5.12.5` e `zod` para `^4.6.6`, regenerar o
   `package-lock.json`, rodar a suíte.
2. Num PR separado: `prisma` e `@prisma/client` para 7. É mudança major,
   então precisa ler o guia de migração. As falhas estão no CLI e na
   leitura de config, não no caminho das requests, por isso o risco de
   esperar é menor.
3. Impedir que volte a acontecer: ver M5.

**Teste que prova:** `npm audit --omit=dev --audit-level=moderate` sai
com código 0 (com exceção documentada para a cadeia do prisma até o item
2 entrar).

#### H3. Troca de senha e email sem a senha atual, e sem derrubar sessões

**Onde:** `src/controllers/UserController.ts:46-53`,
`src/services/userServices.ts:47-67`

**O que acontece:**
- `PATCH /users/:id` aceita `password` e `email` novos só com o access
  token. Não pede a senha atual.
- Ao trocar a senha, os refresh tokens do usuário (`RefreshToken`,
  validade de 7 dias, `src/services/refreshTokenServices.ts:6`) continuam
  valendo.

**Impacto:**
- Quem pega um access token (válido por 1h) troca email e senha e fica
  com a conta de vez.
- Do lado da vítima: se o cookie de refresh dela foi roubado, trocar a
  senha não adianta. O atacante continua emitindo access tokens por até
  7 dias.

**Solução proposta:** o padrão de mercado (OWASP ASVS V2.1.6 e V3.3) é
pedir a senha atual para mudar credenciais e encerrar as outras sessões
quando a senha muda. O que exatamente exigir (só para senha, também para
email, confirmação por link) muda o contrato da API e a experiência do
usuário, então está no
[ADR-0014](../adr/0014-reautenticacao-para-trocar-senha-ou-email.md).

**Teste que prova:** PATCH com senha nova e sem `currentPassword`
responde 400 ou 401. Depois de uma troca de senha válida, `POST /refresh`
com o cookie antigo responde 401.

### MEDIUM

#### M1. O error handler transforma todo erro 4xx do framework em 500

**Onde:** `src/Middleware/errorHandler.ts:25-28`

**O que acontece:** o handler só trata `ZodError` e o `P2002` do Prisma.
Qualquer outro erro vira 500, mesmo quando o Fastify ou um plugin já
mandou o status certo em `error.statusCode`. Isso foi verificado para
JSON malformado (400), body ausente, `Content-Type` não suportado (415),
body acima de 1 MB (413) e **o 429 do `@fastify/rate-limit`**.

**Impacto:**
- Não vaza informação. A resposta continua sendo
  `{ statusCode, error, reqId }`, e isso é um ponto positivo.
- O cliente não consegue distinguir "esperar e tentar de novo" (429) de
  "o servidor quebrou" (500).
- Qualquer pessoa gera logs de nível `error` à vontade. Isso esconde
  falhas reais e atrapalha qualquer alerta configurado em cima de 5xx.

**Solução proposta:** antes do caso genérico, se `error.statusCode`
estiver entre 400 e 499, responder com esse status no formato padrão
`{ error }` (mais `reqId`) e logar em `warn`. O 500 genérico continua
como está.

**Teste que prova:** o 21º `/login` do mesmo IP responde 429, e JSON
malformado responde 400.

#### M2. `/login` não valida o body

**Onde:** `src/controllers/indexController.ts:14`

```ts
const {email,password} = req.body as {email: string, password: string}
```

**O que acontece:** o `as` só convence o TypeScript. Em tempo de
execução, body ausente quebra a desestruturação, e um `email` que não é
string quebra o `.trim()` dentro de `attemptTracker`
(`src/services/attemptTracker.ts:38`). As duas coisas viram 500
(verificado).

**Impacto:** respostas 500 e log de erro sob demanda (soma com M1). A
rota mais exposta da API recebe entrada sem validação.

**Solução proposta:** criar `LoginVal` em `src/schema/userVal.ts`,
reaproveitando as regras de campo que já existem:

```ts
export const LoginVal = z.object({
    email: emailField,
    password: z.string().min(1).max(128),
});
```

Fazer o parse no começo do handler. O `ZodError` já vira 400 no
`errorHandler`.

**Teste que prova:** `POST /login` sem body, e com `email: {}`, responde
400.

#### M3. Validação de entrada incompleta

**Onde e solução proposta, item por item:**

| Onde | O que acontece | Solução proposta |
|---|---|---|
| `src/schema/habitVal.ts:13` | `daysOfWeek` não tem tamanho máximo. Aceita milhares de itens repetidos e grava num `Int[]`. É o caminho do advisory do `zod` no H2. | `.max(7)` mais um `refine` exigindo valores únicos |
| `src/schema/habitVal.ts:8,12,16,18` | `targetPerDay` e `intervalDays` não têm teto. Acima de 2³¹−1 estouram o `Int` (int4) do Postgres e viram 500. **Não executado**, porque precisa de banco. | `.max()` com um teto de produto (ex.: 100 por dia, 365 dias) |
| `src/controllers/HabitController.ts:12` | `req.body as {...}`. Body ausente dá 500. | Passar `req.body ?? {}` para o schema, ou fazer o parse do body inteiro e sobrescrever `userId` |
| `src/schema/userVal.ts:12` | O email não é normalizado. `A@x.com` e `a@x.com` viram contas diferentes, mas o `attemptTracker` trata os dois como um só. | `z.email().trim().toLowerCase()`. Antes, conferir se o banco já tem emails que só diferem pela caixa |
| `src/schema/userVal.ts:8` | O nome não passa por `.trim()`. Três espaços são aceitos. | `.trim()` antes do `.min(3)`, igual ao nome do hábito |
| Params `:id`, `:habitId`, `:userId` em todas as rotas | Não são validados. Não é injeção, porque o Prisma parametriza. | Validar como `z.cuid2()` e responder 400. É higiene, prioridade baixa |

**Teste que prova:** um teste por linha da tabela, cada um esperando 400.

#### M4. Nenhum teste prova o isolamento dos check-ins

**Onde:** `src/controllers/CheckinController.ts:18,39,63,75`

**O que acontece:** o código confere o dono nas quatro rotas de check-in
e está correto. Mas os testes de "não-dono recebe 403" cobrem só hábitos
e usuários (`src/__tests__/ownership.test.ts`,
`src/__tests__/gaps.test.ts:120`). Nenhum teste tenta mexer nos
check-ins de outra pessoa.

**Impacto:** é o controle que impede um usuário de ver e alterar os
dados de outro. Um refactor pode remover a checagem sem nenhum teste
falhar.

**Solução proposta:** em `ownership.test.ts`, quatro testes com o
usuário B usando o hábito do usuário A, todos esperando 403:
`POST` e `DELETE /habits/:habitId/checkin`, `GET /habits/:habitId/checkins`
e `GET /users/:userId/checkins`. Mais um teste confirmando que o banco
não ganhou `HabitLog` depois do `POST` negado.

#### M5. O CI não tem gates de segurança

**Onde:** `.github/workflows/ci.yml`

**O que acontece:**
- Não roda `npm audit`. É por isso que o H2 entrou sem aviso.
- Não tem SAST (`semgrep`) nem varredura de segredos (`gitleaks`).
- Não existe `.github/dependabot.yml`.
- As actions estão fixadas por tag (`actions/checkout@v4`), não por SHA
  de commit.
- Não há bloco `permissions:`, então o `GITHUB_TOKEN` fica com as
  permissões padrão do repositório.

**Impacto:** a próxima dependência vulnerável e o próximo segredo
commitado por engano entram na `main` do mesmo jeito.

**Solução proposta:**
1. `permissions: contents: read` no topo do workflow.
2. Um job `audit` com `npm audit --omit=dev --audit-level=moderate`,
   depois marcado como check obrigatório na proteção da `main`.
3. Um job `gitleaks` varrendo o histórico.
4. `.github/dependabot.yml` para `npm` e `github-actions`, semanal.
5. Fixar as actions por SHA, com a tag num comentário ao lado. O
   Dependabot atualiza os SHAs.

Cada ferramenta pega uma coisa diferente: `npm audit` acha dependência
vulnerável, `gitleaks` acha segredo, `semgrep` acha bug de código. Uma
não substitui a outra.

#### M6. Rotas autenticadas sem limite de uso nem paginação

**Onde:** `src/routes/HabitRoute.ts`, `src/routes/CheckinRoute.ts`,
`src/services/habitServices.ts:79-86`,
`src/repositories/checkinRepository.ts:30-42`

**O que acontece:** depois do login, nada limita quantos hábitos ou
check-ins uma conta cria. As listagens (`GET /habits` para admin,
`GET /users`, `GET .../checkins`) devolvem tudo numa resposta só.

**Impacto:** uma conta autenticada consegue encher o banco e deixar as
listagens cada vez mais lentas e caras. Hoje o dano é limitado porque o
cadastro tem rate limit, mas esse rate limit cai com o H1.

**Solução proposta:** rate limit por usuário nas rotas de escrita,
paginação por cursor nas listagens e/ou teto de hábitos por conta.
Paginação muda o formato da resposta para o `loop-web`, então a escolha
está no [ADR-0015](../adr/0015-limites-para-rotas-autenticadas.md).

### LOW

| ID | Onde | O que acontece | Solução proposta | Sobe de nível quando |
|---|---|---|---|---|
| L1 | `src/services/indexService.ts:8-9` | O `DUMMY_HASH` que iguala o tempo de "email não existe" usa `p=4`. Os hashes reais usam `p=1` (`userServices.ts:23`). Diferença medida: ~31 ms. Dá para descobrir se um email tem conta pelo tempo. Na prática pesa pouco, porque o `POST /users` já responde 409 "Email já cadastrado". | Gerar o dummy com `argon2.hash` usando os mesmos parâmetros do cadastro. Melhor ainda: tirar os parâmetros para uma constante usada nos três lugares. | O cadastro deixar de revelar emails |
| L2 | `src/Middleware/Auth.ts:47` | `jwt.verify` não fixa o algoritmo, e o payload é usado com `as TokenPayload` sem validação. O `alg=none` é rejeitado (verificado). O `role` no token continua valendo até 1h depois de o usuário ser rebaixado ou apagado. | `jwt.verify(token, key, { algorithms: ["HS256"] })` e validar o payload com um schema Zod (`id: z.cuid2()`, `role: z.enum(["USER","ADMIN"])`). | Existir uma tela para mudar papéis ou mais de um admin |
| L3 | `src/Middleware/errorHandler.ts:21` | Todo `P2002` vira "Email já cadastrado.", inclusive violações de outras chaves únicas: dois undos simultâneos (`HabitLog.undoesId`), `GraceFill`, `HabitSchedule`. | Olhar `error.meta?.target` e só usar a mensagem de email quando a chave for `email`. Nos outros casos, um 409 genérico. | — |
| L4 | `HabitController.ts:64-85`, `UserController.ts:40-46`, `CheckinController.ts:13-20` | O recurso é buscado antes de conferir o dono. ID inexistente dá 404, ID de outra pessoa dá 403. Dá para saber se um ID existe. Com cuid2 (impossível de adivinhar), o risco é baixo. | Responder 404 nos dois casos para quem não é dono nem admin. | IDs passarem a ser sequenciais ou expostos |
| L5 | `src/services/attemptTracker.ts:1-3` | O delay de login guarda o estado na memória de um processo só. Com mais de uma instância, cada uma tem o seu contador. | Já tratado no branch de deploy (ADR-0006 lá, risco aceito). | Mais de uma instância em produção |
| L6 | `package.json:24-35` | `tsx` e o CLI `prisma` estão em `dependencies`. Vão para a imagem de produção sem precisar. | Mover `tsx` para `devDependencies`. O `prisma` é usado no `start` (`migrate deploy`); revisar junto com o ADR-0004 do branch de deploy. | — |
| L7 | `src/controllers/indexController.ts:64-66`, `:70-78` | O refresh token não é rotacionado e não detecta reuso (decisão registrada no antigo `DECISIONS.md`, que saiu do repositório). Um site de terceiros consegue chamar `/logout` e deslogar o usuário (CSRF de baixo impacto, porque o cookie é `sameSite: none`). | Registrar a decisão de não rotacionar num ADR, já que o arquivo original não existe mais. Rotação com detecção de reuso fica para quando houver cliente mobile. | Houver cliente mobile ou token de longa duração |

## O que já está bom

Conferido com o mesmo critério dos achados.

- **Isolamento entre usuários.** Toda rota de hábito, check-in e usuário
  confere o dono (`HabitController.ts:36,72,102`,
  `CheckinController.ts:18,39,63,75`, `UserController.ts:46,79`). O
  `userId` de um hábito novo vem do token, nunca do body
  (`HabitController.ts:11`).
- **Atribuição em massa bloqueada.** `UpdateUserVal` é `strictObject` e
  não tem `role` (`userVal.ts:44`). O `createUser` monta os campos um a
  um (`userServices.ts:27-35`), então ninguém se cadastra como admin.
- **Senhas.** Argon2id com 64 MB e 3 iterações (`userServices.ts:20-25`).
  Nenhum `select` devolve o campo `password`.
- **Refresh token.** 32 bytes aleatórios, guardado só como hash sha256
  (`utils/token.ts`), em cookie `httpOnly` e `secure` em produção
  (`config/cookies.ts:22-29`).
- **Segredos.** `.env` no `.gitignore` e nunca commitado. O boot falha se
  a `SECRET_KEY` estiver ausente, tiver menos de 32 caracteres ou for um
  valor de exemplo (`config/secretKey.ts`, `server.ts:8-13`).
- **Erros 500.** Não vazam a mensagem interna, só o `reqId`
  (`errorHandler.ts:27-28`), e há teste para isso
  (`src/__tests__/bugfixes.test.ts:136-150`).
- **CORS.** Lista explícita de origens, e sem a variável cai em
  `localhost`, nunca em `*` (`Middleware/cors.ts:12-16`).
- **Banco.** Nenhum SQL escrito à mão. O Prisma parametriza tudo.
- **CI.** A proteção da `main` exige o job `test`, que roda
  `tsc --noEmit` e a suíte contra um Postgres de verdade.

## Ordem de correção sugerida

Atualizada em `e49d0ef`, já sem M1, M4, L2 e L3:

1. **H2 (fastify e zod)**: só bump de versão. Branch
   `IgorCGouveia/security-h1-h2`. Precisa entrar antes do H1.
2. **M2**: schema do login. Pequeno, e é a rota mais exposta.
3. **M5**: gates de segurança no CI. Impede que o H2 se repita.
4. **H1**, depois que o ADR-0013 for decidido. Não é urgente na Vercel
   (ver a revisão no próprio achado), mas é uma linha.
5. **H3**, depois que o ADR-0014 for decidido.
6. **M3**, **M6** (depois do ADR-0015) e os LOW, na ordem que for mais
   conveniente. O `prisma` 7 vai num PR separado.

Cada PR cita o ID do achado no título ou na descrição, para dar para
seguir da auditoria até a correção.
