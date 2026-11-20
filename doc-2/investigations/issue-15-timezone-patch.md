# Investigação: issue #15, `PATCH /users` deixa trocar o timezone

- **Issue:** [#15](https://github.com/IgorCGouveia/LOOP-API/issues/15)
- **Conferido no commit:** `4fc2b5a`
- **Data:** 2026-11-19
- **Decisão:** [ADR-0002](../adr/0002-timezone-do-usuario-apos-cadastro.md), opção A (timezone fixo depois do cadastro)
- **Status:** corrigido. Teste em `src/__tests__/timezoneFrozen.test.ts`

## Resumo

O sistema calcula "que dia é hoje" com o timezone **atual** do usuário e
compara o resultado com dias que foram gravados com o timezone **que
valia na época**. Enquanto o timezone não muda, as duas coisas são
iguais. Só que o `PATCH /users/:id` deixa mudar o timezone. Depois da
troca, a comparação mistura dois calendários e o streak sai errado sem
nenhum erro aparecer.

## Os pontos, um por um

Como os pontos se relacionam:

```
1. schema herdado ──> deixou o timezone entrar no PATCH sem decisão
                         │
2. causa raiz ─────── troca do timezone (gatilho)
                      + dias gravados sem timezone (condição)
                         │
3. consequência ───── dia pulado que não existiu (leste) / dois dias viram um (oeste)

4. doc contraditória e 5. sem rastro: problemas à parte, que agravam os anteriores
```

### 1. O schema de update herda todos os campos do cadastro

`src/schema/userVal.ts:29-30`:

```ts
export const UpdateUserVal = z.object(CreateUserVal.shape).partial()
```

**O que acontece:** qualquer campo aceito no cadastro passa a ser aceito
no PATCH automaticamente, `timezone` incluído.

**Por que é um problema:** a lista de campos editáveis não foi escrita
por ninguém. Ela é uma consequência do schema de cadastro. Quem adiciona
um campo ao cadastro está abrindo esse campo para edição sem perceber.
O projeto já teve um bug igual: `userId` vazava pelo `UpdateHabitVal` e
permitia trocar o dono de um hábito (corrigido em `8b1a04a`). O padrão de
mercado para schemas de escrita é uma *allowlist* explícita: o schema de
update lista o que pode mudar, e o resto é rejeitado.

O problema é herdar o **conjunto de campos**. Reaproveitar a **regra de
um campo** (a mesma validação de email nos dois schemas) é outra coisa,
e pode fazer sentido.

**Corrigir só este ponto não fecha o ticket.** Ele explica como o
timezone entrou no PATCH sem ninguém decidir isso. Se o schema virar uma
allowlist e o timezone for incluído de propósito, o ponto 2 continua
igual.

### 2. Causa raiz: o timezone muda, mas os dias já gravados não acompanham

Dois fatos do código que só causam dano quando acontecem juntos:

**Gatilho: a troca do timezone.** `src/services/userServices.ts:51`
grava o valor novo direto no `User`:

```ts
if(data.timezone !== undefined) payload.timezone = data.timezone;
```

**Condição: os dias gravados não guardam o timezone.**
`prisma/schema.prisma:89` grava a data já convertida (ex.: `2026-11-16`),
sem registrar qual timezone produziu essa data. O mesmo vale para
`HabitSchedule.effectiveFrom/To` e `GraceFill.date`:

```prisma
date DateTime @db.Date // dia calendário, congelado no timezone do usuário no momento da escrita
```

**Por que é um problema:** nenhum dos dois fatos causa bug sozinho.
- Se o timezone nunca mudasse, não faria diferença a data não saber de
  que fuso veio.
- Se cada data guardasse o próprio timezone, trocar o fuso do usuário
  seria seguro, porque daria para comparar as datas corretamente.

Juntos, eles quebram a invariante
[I1](../architecture/domain-model.md#i1-um-único-referencial-de-dia-por-usuário):
os dias de um usuário passam a estar em calendários diferentes, e o
sistema não tem como saber disso. É como mudar a unidade de uma coluna de
metros para pés sem converter as linhas que já existem.

**Por que os dias antigos não podem ser corrigidos:** são dois motivos
diferentes.
1. **Não há informação para converter.** Tecnicamente daria para rodar
   um UPDATE nas datas. Só que o fuso original não foi salvo, então não
   tem como saber o valor correto. Depois de uma troca, não dá para dizer
   se `2026-11-16` foi segunda em Los Angeles ou em Tóquio.
2. **O log só cresce, por decisão de projeto.** `HabitLog` não recebe
   UPDATE (invariante
   [I3](../architecture/domain-model.md#i3-o-log-só-cresce)). Mesmo com a
   informação, corrigir dias passados no lugar iria contra essa regra.

### 3. Consequência: o "hoje" do check-in usa o timezone novo

`src/services/checkinServices.ts:110` e `:123`:

```ts
const today = getDateOnlyInTimezone(new Date(), owner.timezone);
...
const skippedTargetDays = lastDate ? checkinRepository.targetDaysBetween(schedules, lastDate, today) : [];
```

**O que acontece:** `today` está no calendário novo e `lastDate` está no
calendário antigo. `targetDaysBetween` conta os dias entre as duas datas
como se as duas fossem do mesmo calendário.

**Por que é um problema:** dá dois tipos de erro, dependendo da direção
da troca.

#### 3a. Troca para leste: aparece um dia pulado que não existiu

1. Usuário em `America/Los_Angeles` faz check-in na segunda (`2026-11-16`).
2. Troca para `Asia/Tokyo`.
3. Faz check-in na terça às `2026-11-17T20:00Z`. Em Los Angeles isso é
   terça ao meio-dia. Em Tóquio já é quarta, 05:00.
4. `today = 2026-11-18`, `lastDate = 2026-11-16`. A conta entende que a
   terça foi pulada.
5. Resultado: um grace token é gasto e um `GraceFill` é criado para a
   terça. Se não houver token, o streak volta para 1.

Para o usuário, passaram 24 horas entre um check-in e outro e ele não
pulou dia nenhum.

#### 3b. Troca para oeste: dois dias reais viram um

1. Usuário em `Asia/Tokyo` faz check-in às `2026-11-17 01:00` de Tóquio
   (`2026-11-16T16:00Z`). `date = 2026-11-17`.
2. Troca para `America/Los_Angeles`.
3. Faz check-in 25 horas depois, às `2026-11-17T17:00Z`, que é terça
   09:00 em Los Angeles. `today = 2026-11-17`.
4. As duas datas são iguais. O segundo check-in conta para o mesmo dia
   do primeiro.
5. Resultado: num hábito `DAILY` com meta 1, o streak não sobe. Num
   hábito com meta maior que 1, o progresso de dois dias diferentes é
   somado como se fosse um dia só.

#### 3c. Efeito secundário na agenda

`createScheduleVersion` (`checkinRepository.ts:88`) fecha a versão
vigente com `effectiveTo = today` no timezone atual, e uma agenda
`INTERVAL` conta os dias a partir de `effectiveFrom`
(`checkinRepository.ts:126`). Editar a agenda depois de uma troca de
timezone pode deslocar o ciclo do intervalo em um dia.

### 4. A documentação promete o contrário, e se contradiz

- `docs/API-REFERENCE.md:381-384`: o timezone "não muda depois via
  `PATCH`" e aponta para um `DECISIONS.md` que não existe mais.
- `docs/API-REFERENCE.md:238-241`: o PATCH aceita "qualquer subconjunto
  dos campos de criação", o que inclui `timezone`.

**Por que é um problema:** quem constrói o cliente lê uma das duas
frases e confia nela. Se ler a primeira, nunca vai prever o bug. Se ler
a segunda, pode colocar um campo "fuso horário" na tela de perfil. Além
disso, nenhuma resposta da API devolve o `timezone` (`FindUser` e
`updateUser` não selecionam esse campo), então o cliente não consegue
nem mostrar ou conferir qual timezone está valendo.

### 5. Não dá para saber quem já foi afetado

Não existe registro de quando um timezone mudou nem de qual era o valor
anterior. A issue pede para contar os usuários afetados, e isso não é
possível com os dados atuais. Qualquer opção do ADR-0002 resolve daqui
para frente. Nenhuma recupera o passado.

## Como reproduzir (teste de aceite da issue)

```
1. POST /users com timezone America/Los_Angeles
2. POST /habits (DAILY, meta 1)
3. Inserir um CHECKIN com date = segunda
4. PATCH /users/:id { "timezone": "Asia/Tokyo" }
5. Com o relógio falso em terça 20:00Z, POST /habits/:id/checkin
```

Hoje: o passo 4 responde `200` e o passo 5 gasta um grace token e cria um
`GraceFill`.

O resultado esperado depende da opção escolhida no ADR-0002:
- Congelar: o passo 4 responde `400` e o timezone continua o mesmo.
- Permitir: o passo 5 não muda `graceTokens` e não cria `GraceFill`.

Cuidado ao escrever o teste: `CreateCheckIn` chama `new Date()` direto.
Para fixar a hora, use `vi.useFakeTimers({ toFake: ['Date'] })` e
`vi.setSystemTime(...)`. Simular só o `Date` evita travar os timers que
o Prisma e o Fastify usam.

## Fora do escopo

Os outros achados da mesma auditoria estão listados na issue, na seção
"Out of scope". Cada um ganha uma investigação própria quando for
atacado.
