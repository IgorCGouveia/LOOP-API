# Investigação: auditoria de arquitetura, integridade de dados e deploy

- **Conferido no commit:** `9315eda` (branch `main`). As citações de
  arquivo:linha valem para esse commit.
- **Data:** 2026-11-21
- **Escopo:** arquitetura e limites entre camadas, autenticação e sessão,
  integridade dos dados (streak, grace token, agenda, log de eventos),
  recuperação de falhas, build, migração e deploy na Vercel/Neon
- **Como foi feito:** leitura estática do repositório inteiro por oito
  frentes (arquitetura, integridade de dados, recuperação de falhas,
  controle de acesso, entrada não confiável, dados sensíveis, performance,
  entrega). Cada achado foi conferido contra o código. Nenhum teste,
  migração ou deploy foi executado.
- **Status:** todos abertos. Os que pedem decisão apontam para ADRs
  `Proposto`.

## Resumo

O núcleo continua sólido. Check-in e undo rodam numa transação com a
linha do hábito travada (ADR-0009). O acesso ao hábito fica num lugar só
(ADR-0011). O JWT tem algoritmo fixo e payload validado.

Os problemas novos estão em três lugares:

- **Deploy.** A migração roda dentro do build da Vercel. O banco que ela
  altera é escolhido só pelas variáveis de ambiente, e não existe regra de
  compatibilidade entre a migração e o código anterior. Hoje todas as
  migrações só adicionam coisas, então o risco ainda não se materializou.
- **Sessão.** Um refresh token copiado não tem como ser revogado pela
  vítima. Trocar a senha não derruba sessões, e apagar a conta só exige o
  access token.
- **Regras de streak.** O grace token é gasto em check-ins que não
  completam o dia. A edição de agenda não usa a trava do hábito. O undo
  volta a dias já fechados.

Esta auditoria não repete o que já está nos ADRs 0012–0019, na
[auditoria de segurança](./auditoria-seguranca-2026-11-20.md) ou na
[revisão de design](../proposals/design-review-2026-11-20.md). Quando um
achado confirma ou acrescenta evidência a um item desses, a coluna
"Relação" aponta para ele.

## O que não deu para conferir

Vários achados de deploy dependem de configuração que fica fora do
repositório:

- variáveis de ambiente da Vercel por ambiente (`DATABASE_URL`,
  `DIRECT_URL`, `SECRET_KEY`, `NODE_ENV`, `CORS_ORIGIN`);
- se a Vercel espera os checks do GitHub antes de promover produção, e
  como o Instant Rollback está sendo usado;
- branches do Neon e o estado de `_prisma_migrations` em produção e no
  preview;
- se o backfill de agenda já rodou em produção (o
  [roteiro](../guides/backfill-habit-schedule.md) diz "ainda não
  conferido").

Conferido nesta auditoria: a proteção da `main` exige o check `test` com
`strict`, mas não vale para admins (`enforce_admins: false`).

## Como ler a tabela

- **Severidade:** mesma escala da
  [auditoria de segurança](./auditoria-seguranca-2026-11-20.md#como-cada-ponto-é-classificado).
- **Confiança:** 100 quando o código prova o defeito sozinho. 75 quando o
  defeito está no código, mas depende de uma condição declarada (tráfego
  concorrente, configuração externa). 50 quando depende de uma suposição
  que ninguém conferiu.
- **ID:** estável, para citar no PR e no commit da correção. O prefixo diz
  a área: `D` deploy, `S` sessão e segurança, `I` integridade de dados,
  `P` performance.

## Achados

### Deploy

| ID | Achado | Onde | Severidade | Confiança | Relação |
|---|---|---|---|---|---|
| D1 | O build de preview pode migrar o banco de produção. O script escolhe o banco por `DIRECT_URL \|\| DATABASE_URL_UNPOOLED \|\| DATABASE_URL` e não confere se ele é o banco esperado para o `VERCEL_ENV`. O próprio comentário do script diz que a proteção é só documentação | `scripts/vercel-migrate.mjs:11-13`, `:28` | HIGH | 75 | — |
| D2 | A migração é aplicada no meio do build, enquanto o deployment anterior ainda atende. Ela continua aplicada se o deploy falhar depois ou se houver Instant Rollback. Nada exige que a migração seja compatível com o código anterior (expand/contract) e não há roteiro para uma migração que falha (`P3009` trava os builds seguintes) | `package.json:17`, `scripts/vercel-migrate.mjs:35` | MEDIUM | 75 | [ADR-0019](../adr/0019-runtime-de-deploy.md) |
| D3 | O banco de preview é um só, sem dados e compartilhado por todos os PRs. Migrações de PRs diferentes se acumulam nele, e uma migração que só falha com dados reais (índice único sobre duplicatas, `SET NOT NULL`) aparece pela primeira vez em produção | `README.md:285`, `.github/workflows/ci.yml:52` | MEDIUM | 75 | — |
| D4 | `api/index.ts`, o entrypoint de produção, não passa pelo gate de tipos nem pelos testes. O `tsconfig.json` só inclui `src/**/*.ts`, e nenhum teste importa o handler | `tsconfig.json:24`, `.github/workflows/ci.yml:49-50` | MEDIUM | 100 | — |
| D5 | Nada na Vercel espera o CI antes de migrar. Em produção, a proteção da `main` cobre o caso comum: o merge exige o `test` verde. Sobram dois buracos: um admin pode fazer merge sem o check, e os builds de preview migram antes de o CI do PR terminar | `vercel.json:4`, `scripts/vercel-migrate.mjs:22` | LOW | 75 | — |

### Sessão e segurança

| ID | Achado | Onde | Severidade | Confiança | Relação |
|---|---|---|---|---|---|
| S1 | A vítima não tem como revogar um refresh token copiado. A única revogação é pelo hash do cookie apresentado no `/logout`, e a troca de senha não toca na tabela `RefreshToken`. A consequência aceita no ADR-0006 ("vale até expirar ou até o logout") não vale para a cópia do atacante, que fica válida por 7 dias | `src/services/refreshTokenServices.ts:44`, `src/services/userServices.ts:62` | HIGH | 75 | Revisitar [ADR-0006](../adr/0006-autenticacao-jwt-e-refresh-em-cookie.md), decidir junto do [ADR-0014](../adr/0014-reautenticacao-para-trocar-senha-ou-email.md) |
| S2 | `DELETE /users/:id` apaga a conta inteira em cascade com o mesmo modelo de identidade do H3: basta o access token. O ADR-0014 só cobre a troca de email e de senha | `src/controllers/UserController.ts:78` | HIGH | 75 | H3, [ADR-0014](../adr/0014-reautenticacao-para-trocar-senha-ou-email.md) |
| S3 | O JWT não diz para qual ambiente foi emitido (sem `aud`/`iss`). O README separa os bancos de preview e produção, mas lista uma `SECRET_KEY` só. Se for a mesma chave nos dois ambientes, um token ADMIN emitido no preview vale em produção | `src/services/indexService.ts:22`, `README.md:300` | HIGH se a chave for compartilhada | 50 | — |
| S4 | `ScheduleVal` aceita `daysOfWeek` de qualquer tamanho, com repetição, e `targetPerDay`/`intervalDays` sem teto. Valores acima de 2³¹−1 estouram o `Int` e viram 500, e cada `PATCH` grava uma versão nova, que todo check-in carrega sob a trava | `src/schema/habitVal.ts:13` | MEDIUM | 75 | M3, [ADR-0015](../adr/0015-limites-para-rotas-autenticadas.md) |
| S5 | O email do login não tem limite de tamanho e vira chave do `attemptTracker` por 15 minutos. O teto do Map é por número de entradas, não por bytes | `src/controllers/indexController.ts:14`, `src/services/attemptTracker.ts:132` | MEDIUM | 50 | M2 |
| S6 | O `/logout` limpa o cookie passando só o `path`. Numa chamada cross-site, o navegador descarta a limpeza (o token já está revogado no banco) | `src/controllers/indexController.ts:76` | LOW | 75 | — |
| S7 | O Swagger UI do `/docs` usa `persistAuthorization: true` e grava o JWT no `localStorage` da origem da API. O guia da API manda o cliente evitar isso | `src/docs.ts:54` | LOW | 75 | [ADR-0008](../adr/0008-documentacao-openapi.md) |
| S8 | O `Secure` do cookie de refresh depende de `NODE_ENV === "production"`. Sem a variável, o cookie sai sem `Secure`, e nenhum guard de boot confere isso | `src/config/cookies.ts:11` | LOW | 50 | — |
| S9 | No `/login`, um `password` que não é string pode dar 500 para conta existente e 401 para inexistente: o `.catch` do argon2 só existe no caminho do email inexistente | `src/services/indexService.ts:35`, `:38` | LOW | 50 | M2 |

O H1 (`trustProxy: true`) continua aberto em `9315eda`, latente na
Vercel. Ver o [ADR-0013](../adr/0013-como-a-api-descobre-o-ip-do-cliente.md).

### Integridade de dados

| ID | Achado | Onde | Severidade | Confiança | Relação |
|---|---|---|---|---|---|
| I1 | O grace token é gasto num check-in que não completa o dia. Com `targetPerDay > 1`, ou num dia fora da agenda WEEKLY, o primeiro check-in já grava o `GraceFill` e debita o token. Com saldo ≥ 2, um buraco de 2 dias-alvo vira streak contínua, o caso que o ADR-0010 diz que nunca pode acontecer | `src/services/checkinServices.ts:63-70` | MEDIUM | 100 | [ADR-0010](../adr/0010-desfazer-check-in-devolve-grace-token.md) |
| I2 | A edição de agenda não pega a trava do hábito, e nenhuma constraint garante uma versão vigente por hábito. Dois `PATCH` ao mesmo tempo deixam duas versões com `effectiveTo` nulo, e cada leitor escolhe uma diferente. O `audit:integrity` não detecta isso | `src/services/habitServices.ts:107`, `src/repositories/checkinRepository.ts:127-131` | MEDIUM | 75 | D7 da revisão de design |
| I3 | O undo volta a dias já fechados. `findUndoableCheckIn` não tem limite de data, e o check-in sempre grava "hoje", então cada undo extra apaga mais um dia passado sem forma de refazer. Isso contradiz o invariante I2 do modelo de domínio e a premissa do ADR-0018 ("o passado é imutável") | `src/repositories/checkinRepository.ts:39` | MEDIUM | 75 | [ADR-0018](../adr/0018-custo-do-calculo-de-streak.md), [domain-model I2](../architecture/domain-model.md) |
| I4 | O retry depois de uma falha ambígua grava de novo. O `API-REFERENCE` promete que repetir depois de um 500 é seguro, mas isso só vale se o COMMIT não aconteceu. Se a confirmação do commit se perdeu, o retry cria um segundo CHECKIN, e um undo repetido desfaz um check-in legítimo | `docs/API-REFERENCE.md:138`, `src/services/checkinServices.ts:42` | MEDIUM | 75 | [ADR-0009](../adr/0009-unidade-de-trabalho-por-caso-de-uso.md) |
| I5 | O saldo de grace token aparece nas listagens sem a reposição mensal, que só é gravada no check-in. Quem ficou um mês sem check-in vê 0 tendo 1 | `src/services/habitServices.ts:71` | LOW | 75 | — |
| I6 | O email é salvo com a caixa original e o `@unique` diferencia caixa. `T@x.com` e `t@x.com` viram duas contas, enquanto o `attemptTracker` trata os dois como o mesmo email | `src/schema/userVal.ts:16`, `src/services/attemptTracker.ts:37` | MEDIUM | 50 | D2 da revisão de design, M3 |
| I7 | Editar a agenda de um hábito legado antes do backfill apaga o histórico dele: a versão nova começa hoje, e o backfill passa a pular o hábito | `src/repositories/checkinRepository.ts:138`, `src/scripts/habitScheduleBackfill.ts:23` | MEDIUM se o backfill não rodou | 50 | [Roteiro de backfill](../guides/backfill-habit-schedule.md) |
| I8 | A correção pendente `fix:backfill-effective-from` faz UPDATEs em sequência numa única transação com o timeout padrão de 5 s. Com volume ou latência suficientes, ela aborta, e cada nova tentativa falha do mesmo jeito | `src/scripts/habitScheduleBackfill.ts:81-83` | LOW | 50 | — |

### Performance

| ID | Achado | Onde | Severidade | Confiança | Relação |
|---|---|---|---|---|---|
| P1 | `getEffectiveLog` é O(dias × eventos), não O(eventos) como o ADR-0018 registra: `isCompleted` percorre todos os eventos para cada dia. Roda duas vezes por check-in, com a trava presa | `src/repositories/checkinRepository.ts:211`, `src/domain/schedule.ts:61` | MEDIUM | 100 | Evidência nova para o [ADR-0018](../adr/0018-custo-do-calculo-de-streak.md) |
| P2 | `Habit.userId` não tem índice. `GET /me/habits` e as listagens por usuário leem a tabela inteira. Para aplicar o índice, usar `CREATE INDEX CONCURRENTLY`, porque a migração roda contra o banco vivo | `prisma/schema.prisma:47` | MEDIUM | 100 | D1 da revisão de design |
| P3 | As transações de check-in herdam os timeouts padrão do Prisma (`maxWait` 2 s, `timeout` 5 s). A espera pela trava conta dentro do timeout, e o `P2028` não é mapeado, então vira 500 | `src/services/checkinServices.ts:42`, `src/Middleware/errorHandler.ts:82` | MEDIUM | 50 | [ADR-0009](../adr/0009-unidade-de-trabalho-por-caso-de-uso.md) |

## Decisões que esta auditoria pede

- **[ADR-0006](../adr/0006-autenticacao-jwt-e-refresh-em-cookie.md):**
  a consequência aceita sobre o refresh vazado parte de uma premissa que
  não vale (S1). Não muda a decisão de não rotacionar. Pede uma forma de
  revogar por usuário.
- **[ADR-0014](../adr/0014-reautenticacao-para-trocar-senha-ou-email.md):**
  incluir o `DELETE /users/:id` no escopo (S2) e decidir a revogação por
  usuário junto (S1).
- **Undo (I3):** restringir ao dia de hoje ou corrigir o invariante I2 e
  o ADR-0018. Qualquer das duas pede um ADR.
- **Migração no deploy (D1, D2, D5):** cabe no
  [ADR-0019](../adr/0019-runtime-de-deploy.md). Precisa decidir onde a
  migração de produção roda, qual gate ela espera e qual regra de
  compatibilidade vale.

## Ordem sugerida

1. **Conferir a configuração externa** listada em
   [O que não deu para conferir](#o-que-não-deu-para-conferir). É ela que
   decide a severidade real de D1, D5, S3 e S8.
2. **Correções contidas, sem decisão pendente:** I1, I2, D4, P2, S6 e S7.
   Cada uma tem um teste de integração direto.
3. **Decisões:** ADR-0014 e a revogação por usuário (S1, S2), regra do
   undo (I3), ADR-0019 (D1, D2).
4. **Depois disso:** I4 (idempotência), D3 (branch do Neon por preview) e
   o restante.
