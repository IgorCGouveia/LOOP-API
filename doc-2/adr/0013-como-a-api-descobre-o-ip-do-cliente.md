# ADR-0013: Como a API descobre o IP do cliente

- **Status:** Proposto
- **Data:** 2026-11-20, contexto revisado em 2026-11-21 com medição em produção
- **Decisor:** dono do projeto
- **Relacionado:** [auditoria de segurança, achado H1](../investigations/auditoria-seguranca-2026-11-20.md#h1-trustproxy-true-deixa-o-cliente-escolher-o-próprio-ip),
  PR #27 (deploy na Vercel), [ADR-0015](./0015-limites-para-rotas-autenticadas.md),
  [ADR-0003](./0003-fastify-como-framework-http.md) (registra `trustProxy: true` como parte da escolha do Fastify; aceito este ADR, a linha sobre `trustProxy` passa a ser substituída por ele)


## Contexto

O rate limit por IP (`@fastify/rate-limit`, `src/Middleware/rateLimit.ts:15-19`)
conta as requests por `req.ip`. Esse limite protege o `/login` (20/min,
`src/routes/indexRoute.ts:13`) e o cadastro (5/h,
`src/routes/UserRoute.ts:13`). Hoje o Fastify sobe com `trustProxy: true`
(`src/app.ts:21`, conferido em `e49d0ef`). O comentário ao lado ainda
fala do Render.

**Como `trustProxy: true` funciona.** O Fastify confia em todos os
proxies e usa o endereço mais à esquerda do `X-Forwarded-For`. Numa
hospedagem que só acrescenta IPs à direita, esse endereço vem do
cliente. Num teste local, `X-Forwarded-For: 6.6.6.6, 10.0.0.1` virou
`req.ip = 6.6.6.6`, e trocar o header a cada request passou pelo limite.

**Como a produção se comporta (medido em 2026-11-21).** A produção roda
na Vercel desde o PR #27 (`api/index.ts`, `vercel.json`). O front
(`loop-web`) faz rewrite de `/api/*` para a API. Foram enviadas requests
com `X-Forwarded-For` forjado, direto na API e pelo rewrite, e conferido
o `remoteAddress` que o log do Fastify registrou:

| Caminho | `X-Forwarded-For` enviado | `req.ip` registrado |
|---|---|---|
| `loop-api-jade.vercel.app/login` | `203.0.113.77` | IP real do cliente |
| `loop-api-jade.vercel.app/login` | `203.0.113.77, 198.51.100.9` | IP real do cliente |
| `loop-web-eosin.vercel.app/api/login` | `203.0.113.88` | IP real do cliente |

Isso bate com a documentação da Vercel (`vercel.com/docs/headers/request-headers`):
ela sobrescreve o `X-Forwarded-For` e não repassa IPs vindos de fora. A
documentação também cita `x-real-ip` e `x-vercel-forwarded-for` com o
mesmo valor. O `x-vercel-forwarded-for` existe para o caso de haver outro
proxy na frente da Vercel que reescreva o `X-Forwarded-For`.

**Consequência:** na Vercel, o H1 não é explorável hoje. Ele volta a ser
se o mesmo código rodar atrás de um proxy que só acrescenta IPs: Render,
Nginx, `src/server.ts` numa VM, ou um Cloudflare na frente da Vercel.

**Outros fatos que pesam na decisão:**
- O rate limit e o `attemptTracker` guardam o estado na memória de cada
  instância da função. Na Vercel, cada instância conta separado e zera
  quando é reciclada. Isso não depende de qual IP é lido.
- O `fastify` 5.8.5 tem uma falha no modo de contagem de hops
  (GHSA-3m5p-2c4r-xxw2). Ela está corrigida no H2 (`fastify` 5.12.8).

## Opções consideradas

### Opção A: contar os hops (`trustProxy: 1`)
- Como funciona: o Fastify confia só no proxy imediatamente à frente e
  usa o último IP que ele escreveu. Se na Vercel o header chega com um IP
  só, o resultado é o mesmo de hoje.
- **Não verificado:** a medição mostra que o IP mais à esquerda é o real,
  não que o header tem um IP só. Se a Vercel acrescentar um IP interno à
  direita, `trustProxy: 1` passaria a contar esse IP interno. Antes do
  merge, um deploy de preview que registre o `X-Forwarded-For` bruto
  resolve a dúvida.
- Muda no contrato da API: nada.
- Precisa de migração: não.
- Ganha: uma linha. Resultado igual na Vercel e seguro atrás de qualquer
  proxy único que acrescenta IPs (Render, Nginx). Não depende do provedor.
- Perde: atrás de dois ou mais proxies que acrescentam IPs, por exemplo
  um Cloudflare na frente da Vercel, passa a contar o IP do proxy do meio.
  Todos os usuários dividiriam um contador. O número precisa ser revisto
  se a infraestrutura mudar.

### Opção A': o número da opção A vindo de variável de ambiente
- Como funciona: `TRUST_PROXY_HOPS`, com padrão 1 e validada no boot.
- Muda no contrato da API: nada. Uma variável nova na tabela de
  configuração.
- Precisa de migração: não.
- Ganha: ajustar para outra infraestrutura não precisa de deploy de código.
- Perde: mais uma configuração por ambiente, e continua sendo preciso
  descobrir o número certo.

### Opção B: ler o header da Vercel (`x-vercel-forwarded-for`)
- Como funciona: `trustProxy: false` e `keyGenerator` no rate limit lendo
  `x-vercel-forwarded-for`. Sem o header (dev local, testes), usa o IP da
  conexão.
- Muda no contrato da API: nada.
- Precisa de migração: não.
- Ganha: continua certo mesmo com outro proxy na frente da Vercel.
- Perde: fica preso à Vercel. Fora dela, qualquer cliente escreve esse
  header e o problema volta: o código teria que saber se está ou não na
  Vercel. O `req.ip` usado nos logs continua sendo o da conexão, a menos
  que seja tratado à parte.

### Opção C: confiar só nos endereços do proxy (`trustProxy: [CIDRs]`)
- Como funciona: lista de IPs ou faixas dos proxies da hospedagem.
- Muda no contrato da API: nada.
- Precisa de migração: não.
- Ganha: é o modelo mais preciso.
- Perde: a Vercel não publica faixas estáveis dos proxies (não
  verificado). A lista vira manutenção manual.

### Opção D: rate limit na borda (Vercel Firewall ou Cloudflare)
- Como funciona: uma regra de rate limit em `/login` e `/users`
  configurada no provedor, que vê a conexão real antes da função rodar.
- Muda no contrato da API: nada. A borda responde 429 com o formato dela,
  não o da API.
- Precisa de migração: não.
- Ganha: o IP vem da conexão. O contador é global, o que resolve o estado
  em memória por instância. A request bloqueada nem invoca a função.
- Perde: configuração fora do repositório, a menos que venha por código
  (`vercel.json` ou Terraform). **Não verificado:** se o rate limit do
  Vercel Firewall existe no plano Hobby e com quais limites. A Cloudflare
  exige domínio próprio. Não dispensa corrigir o `trustProxy`, que
  continua sendo a última barreira se a borda for contornada.

### Opção E: proteger o login sem depender de IP
- Como funciona: duas variantes, que podem ser combinadas:
  - teto global de falhas de login: o `attemptTracker` ganha uma chave
    global, e acima de N falhas por minuto todo login recebe atraso;
  - CAPTCHA sem fricção (Cloudflare Turnstile) depois de algumas falhas.
- Muda no contrato da API: o teto global, nada. O CAPTCHA, um campo novo
  no `POST /login`.
- Precisa de migração: não.
- Ganha: freia password spraying (uma senha testada contra muitos
  emails, de muitos IPs), que o limite por IP não pega.
- Perde: o teto global deixa um atacante tornar o login lento para todos
  (atraso, não bloqueio). O CAPTCHA traz dependência externa e muda o
  front. O teto global em memória sofre do mesmo problema por instância.
  É uma camada a mais: não corrige o `trustProxy`.

As opções D e E se somam a A, A', B ou C. Elas não substituem nenhuma.

## Decisão

<Preencher quando o status for Aceito.>

## Consequências

- Seja qual for a opção entre A, A', B e C, o teste de regressão é o
  mesmo: requests ao `/login` do mesmo `remoteAddress`, com
  `X-Forwarded-For` diferente a cada vez, recebem 429 a partir da 21ª.
  Com a opção B, o teste usa `x-vercel-forwarded-for`.
- O comentário em `src/app.ts:19-20` (que fala do Render) muda junto.
- A medição desta revisão pode ser repetida: `POST /login` com body vazio
  responde 400 sem tocar no banco, e o `remoteAddress` aparece nos runtime
  logs do projeto `loop-api`.
