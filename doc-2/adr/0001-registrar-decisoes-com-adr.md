# ADR-0001: Registrar decisões de arquitetura com ADR

- **Status:** Aceito
- **Data:** 2026-11-19
- **Decisor:** dono do projeto (delegou a manutenção da documentação)

## Contexto

As decisões do projeto ficavam num `DECISIONS.md` único, que foi
removido do histórico. Ficaram referências para ele sem destino
(`docs/API-REFERENCE.md:18`, `:383`). Os comentários no código explicam
o "como", mas não as alternativas que foram descartadas.

## Decisão

Cada decisão de arquitetura vira um arquivo em `doc-2/adr/`, numerado,
no formato de Michael Nygard (contexto, opções, decisão, consequências).

## Consequências

- Uma decisão por arquivo. Fica fácil linkar de um PR, de um comentário
  no código ou de outro ADR.
- ADR aceito não é editado. O histórico de "por que mudamos de ideia"
  fica preservado.
- Custo: decisões pequenas também precisam de arquivo. O critério para
  criar um ADR é o mesmo do protocolo de decisão do projeto: arquitetura,
  modelagem de dados, contrato de API, tratamento de erro.
- Os ADRs ficam versionados no repositório, que é público. Não registrar
  aqui nada que não possa ficar público.
