# ADR-0002: O timezone do usuário pode mudar depois do cadastro?

- **Status:** Aceito (opção A)
- **Data:** 2026-11-19
- **Decisor:** dono do projeto
- **Relacionado:** issue #15, [investigação](../investigations/issue-15-timezone-patch.md), invariante [I1](../architecture/domain-model.md#i1-um-único-referencial-de-dia-por-usuário)

## Contexto

Os dias locais (`HabitLog.date`, `HabitSchedule.effectiveFrom/To`,
`GraceFill.date`) são gravados já convertidos e sem o timezone junto. O
cálculo de streak compara esses dias com o "hoje" calculado no timezone
atual. Hoje o `PATCH /users/:id` aceita `timezone`. Depois de uma troca,
o sistema cria dias pulados que não existiram (troca para leste) ou junta
dois dias em um (troca para oeste). Os detalhes e a reprodução estão na
investigação.

Restrições:
- As linhas que já existem não podem ser corrigidas, porque o timezone
  antigo nunca foi salvo.
- Mudar o contrato do PATCH afeta os clientes (mobile e `loop-web`). Os
  dois ainda estão em construção.
- Pelo protocolo do projeto, migração de banco só com aprovação explícita.

## Opções consideradas

### Opção A: congelar o timezone (rejeitar no PATCH)

**Como funciona**
- `UpdateUserVal` passa a ser uma allowlist explícita (`name`, `email`,
  `password`, `confirmPassword`) com `.strict()`, então qualquer chave
  fora da lista vira `400` pelo `errorHandler` que já existe, com
  `details` apontando o campo.
- Remover a linha do `timezone` em `updateUser`.
- Atualizar `API-REFERENCE.md` (a seção do PATCH e a de fuso horário).

**Contrato:** `PATCH /users/:id` com `timezone` passa a responder
`400 { error: "Dados inválidos.", details: [...] }`. O `.strict()` também
rejeita qualquer outra chave desconhecida (ex.: `role`), que hoje é
ignorada sem aviso.

**Migração:** nenhuma.

**Arquivos:** `src/schema/userVal.ts`, `src/services/userServices.ts`,
`docs/API-REFERENCE.md`, um teste novo.

**Ganha**
- A invariante I1 passa a valer de fato.
- Fecha também a classe de bug do ponto 1: um campo novo no cadastro não
  fica editável sem alguém decidir isso.
- A mudança é só de código e é fácil de reverter.

**Perde**
- Quem se muda de vez (ex.: de São Paulo para Lisboa) fica com o "dia"
  defasado para sempre. A única saída é criar outra conta ou alguém
  editar o banco.
- Quem viaja tem check-ins contados no fuso de casa. O usuário pode ver
  "ainda é ontem" quando, para ele, já é hoje.
- Cliente que já manda `timezone` no PATCH quebra (hoje não há cliente
  em produção que faça isso).

### Opção B: permitir a troca, com histórico e corte no próximo dia local

**Como funciona**
- Tabela nova, por exemplo `UserTimezone (userId, timezone,
  effectiveFrom DATE, effectiveFromAt TIMESTAMP)`, seguindo o mesmo
  padrão de versão do `HabitSchedule`.
- A troca não vale na hora. Ela começa no **próximo dia local do
  timezone antigo**. O dia em andamento termina no calendário em que
  começou.
- Todo cálculo de "que dia é hoje" passa por uma única função (ex.:
  `resolveLocalDay(userId, instant)`) que escolhe a versão de timezone
  daquele instante. Hoje `getDateOnlyInTimezone` é chamado em 3 lugares
  (`checkinServices.ts:110`, `habitServices.ts:57`, `habitServices.ts:100`).
- Na troca para oeste, o primeiro dia no fuso novo pode cair numa data
  que já fechou no fuso antigo. Regra necessária: o primeiro dia depois
  do corte é sempre `max(data local nova, último dia antigo + 1)`.

**Contrato:** o PATCH continua aceitando `timezone`, mas a troca passa a
ser agendada e não imediata. A resposta precisa dizer a partir de quando
a troca vale. Também vale considerar devolver o `timezone` nas respostas,
porque hoje ele nunca volta.

**Migração:** sim. Tabela nova, mais um backfill com uma linha por
usuário usando o timezone atual.

**Arquivos:** `schema.prisma`, migração, `src/utils/date.ts` (ou um
service novo), `checkinServices.ts`, `habitServices.ts`,
`userServices.ts`, testes para leste, oeste e troca dupla no mesmo dia.

**Ganha**
- O comportamento fica correto para quem viaja ou se muda.
- Fica registrado quem trocou e quando, o que resolve o ponto 5 daqui
  para frente.
- Segue um padrão que o projeto já usa e testa (versão do schedule).

**Perde**
- É a opção mais complexa. Toda leitura de "dia" passa a depender de um
  histórico, e a regra do `max(...)` é um caso de borda sutil que precisa
  de teste.
- Cada check-in faz uma consulta a mais (dá para trazer junto com a
  busca do usuário).
- A UX da troca agendada precisa ser explicada no cliente ("seu novo fuso
  vale a partir de amanhã").

### Opção C: permitir a troca na hora, com tolerância de um dia no primeiro check-in seguinte

**Como funciona**
- Duas colunas novas em `User`: `previousTimezone` e `timezoneChangedAt`.
- Na troca, as duas são preenchidas e o `timezone` muda na hora.
- No primeiro `CreateCheckIn` em que `lastLog.checkedAt <
  timezoneChangedAt`, a conta do gap usa o "hoje" no
  **timezone antigo**, mas a data gravada usa o timezone novo.

**Contrato:** nenhuma mudança visível. O PATCH continua igual.

**Migração:** sim, só duas colunas que podem ser nulas, sem backfill.

**Arquivos:** `schema.prisma`, migração, `userServices.ts`,
`checkinServices.ts`, testes.

**Ganha**
- Resolve o caso mais caro (3a, gastar token ou zerar streak por um dia
  que não foi pulado) com pouco código.
- O cliente não precisa mudar nada.

**Perde**
- É uma aproximação. O caso 3b (dois dias viram um, na troca para oeste)
  **continua acontecendo**.
- Guarda só a troca mais recente. Duas trocas antes de um check-in
  perdem a do meio.
- `effectiveFrom` da agenda continua sem tratamento (3c).
- Adiciona uma regra especial ("só no primeiro check-in depois da
  troca") que quem mexer no código depois vai precisar entender.

## Decisão

**Opção A.** O timezone fica fixo a partir do cadastro, e o PATCH de
usuário aceita só uma lista fechada de campos.

Motivos:
- **Deixa as outras opções abertas.** Com o fuso fixo, nenhum dia novo
  é gravado num calendário diferente. Se no futuro a troca de fuso
  virar requisito (opção B), a tabela de histórico começa com o fuso
  atual de cada usuário, e esse dado vai estar correto porque ninguém
  trocou desde esta decisão. Começar pela C deixaria colunas e uma regra
  especial no check-in que teriam de ser removidas depois.
- **Ninguém é afetado hoje.** A API ainda não tem usuários reais, e os
  clientes estão em construção. O custo da A, que é prender quem se muda
  ao fuso antigo, ainda não atinge ninguém.
- **Resolve também o ponto 1 da investigação.** A lista fechada de
  campos impede que um campo novo do cadastro fique editável sem uma
  decisão explícita.
- **Custo baixo e reversível.** Não há migração, e voltar atrás é só
  código.

## Consequências

- `PATCH /users/:id` com `timezone`, ou com qualquer chave fora de
  `name`/`email`/`password`/`confirmPassword`, responde `400` e não
  grava nada, nem os campos válidos enviados junto. Antes, chaves
  desconhecidas como `role` eram ignoradas sem aviso.
- O `details` desse `400` vem com `campo: ""`, porque o Zod associa o
  erro de chave desconhecida ao objeto inteiro, não a um campo. O nome da
  chave aparece na `message`. Preencher `campo` com o nome da chave
  exigiria mudar o `errorHandler`, que é uma decisão à parte.
- As regras de validação de cada campo continuam compartilhadas entre
  cadastro e update (`src/schema/userVal.ts`). Cada schema tem a sua
  própria lista de campos.
- Quem se muda de vez não tem como corrigir o fuso pela API. Se isso
  virar um problema real, o caminho é um ADR novo adotando a opção B, e
  não reabrir o campo no PATCH.
- As linhas gravadas depois de trocas antigas continuam misturadas, e
  não tem como saber quais são (ponto 5 da investigação). Como a API não
  tem usuários reais, o impacto prático é nulo.
- O teste de aceite da issue #15 está em
  `src/__tests__/timezoneFrozen.test.ts`. Ele falha no código anterior e
  passa no atual.
- Fica em aberto: a API continua sem devolver o `timezone` nas
  respostas, então o cliente não consegue mostrar ao usuário qual fuso
  está valendo. Isso muda o contrato e precisa de decisão própria.
