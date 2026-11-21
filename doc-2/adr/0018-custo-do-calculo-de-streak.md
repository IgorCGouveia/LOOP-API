# ADR-0018: Como limitar o custo do cálculo de streak por check-in?

- **Status:** Proposto
- **Data:** 2026-11-20 (contexto revisto em 2026-11-21, depois do PR #26)
- **Decisor:** dono do projeto
- **Relacionado:** [revisão de design](../proposals/design-review-2026-11-20.md#52-leituras-que-crescem-com-o-histórico) (C3), [ADR-0009](./0009-unidade-de-trabalho-por-caso-de-uso.md), invariantes I2 e I3

## Contexto

Conferido no commit `e49d0ef`.

`getEffectiveLog` (`checkinRepository.ts:193-219`) busca **todos** os
eventos e todos os `GraceFill` do hábito e calcula `completed(D)` para
cada dia com evento. `CreateCheckIn` chama essa função 2 vezes
(`checkinServices.ts:55`, `79`) e `UndoCheckIn` também 2
(`checkinServices.ts:123`, `146`). O cálculo de streak para no primeiro
buraco, mas só depois de o log inteiro já ter sido lido.

Custo por check-in: O(eventos do hábito) em I/O e CPU, duas vezes. Um
hábito diário com 3 anos tem ~1.100 dias e alguns milhares de linhas.
Ainda funciona, mas o tempo de resposta cresce com a idade do hábito.
Desde o PR #26 ([ADR-0009](./0009-unidade-de-trabalho-por-caso-de-uso.md)),
check-in e undo rodam numa transação com `SELECT ... FOR UPDATE` na
linha do `Habit`. Então esse tempo é também o tempo que a trava e uma
conexão do pool ficam presas. A própria ADR-0009 registra isso como o
custo da opção escolhida.

Fatos que pesam:

- Dia fechado não muda de veredito (I2), e o log só cresce (I3). Então
  o passado é imutável, e só o dia de hoje e o fim da sequência atual
  mudam.
- Um undo pode desfazer um check-in de hoje, e com isso encurtar a
  sequência que detém o recorde (`undoAffectsRecord`,
  `checkinServices.ts`, dentro de `UndoCheckIn`).
- O grace fill depende do último dia efetivo antes de hoje.

## Opções consideradas

### Opção A: manter o recálculo completo, mas ler uma vez só
- Buscar eventos, agenda e grace fills uma vez por requisição e recalcular em memória o "antes" e o "depois" a partir dessa leitura.
- Muda no contrato: não.
- Precisa de migração: não.
- Ganha: corta de 2 leituras completas para 1. Nenhuma mudança de modelo e nenhum risco de estado materializado ficar diferente do log.
- Perde: continua O(histórico) por requisição. Adia o problema sem resolver.

### Opção B: materializar o estado da sequência atual em `Habit`
- Novas colunas: `currentStreak`, `currentStreakStartDate`, `lastEffectiveDate`.
- O check-in atualiza essas colunas de forma incremental (O(1) mais a leitura do dia de hoje). O undo recalcula a partir de uma janela curta e, só quando mexer no recorde, faz o recálculo completo (como hoje).
- Muda no contrato: não. A listagem de hábitos pode passar a devolver `currentStreak` sem custo extra.
- Precisa de migração: sim, mais um backfill que roda o cálculo atual para cada hábito.
- Ganha: custo constante no caminho comum. Habilita mostrar streak na lista de hábitos. A transação da ADR-0009 fica curta.
- Perde: estado derivado pode ficar diferente do log se algum caminho de escrita esquecer de atualizar. Precisa de um teste de propriedade que compare "incremental" com "recálculo completo", e de um comando para reconstruir.

### Opção C: ler só uma janela recente
- Ler eventos de `date >= lastEffectiveDate - K dias` (ou dos últimos N dias-alvo) e só cair no recálculo completo quando a sequência atravessar a janela.
- Muda no contrato: não.
- Precisa de migração: não (usa o índice `(habitId, date)` que já existe).
- Ganha: limita a leitura sem estado novo.
- Perde: a sequência atual de um usuário assíduo atravessa qualquer janela fixa, e aí o custo volta. A lógica de borda (agenda `INTERVAL` começando antes da janela, grace fill na borda) é sutil.

## Decisão

<Pendente.>

## Consequências

<Preencher quando aceito.>
