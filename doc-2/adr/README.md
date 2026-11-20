# Registro de decisões de arquitetura (ADR)

Formato de Michael Nygard. Cada arquivo registra uma decisão. Use o
[template](./template.md) para criar um novo.

## Ciclo de vida

`Proposto` → `Aceito` → (opcional) `Substituído por ADR-NNNN` ou `Descontinuado`

- Um ADR `Aceito` não é editado. Se a decisão mudar, cria-se um ADR novo
  que referencia o antigo, e o antigo muda só a linha de status.
- Um ADR `Proposto` lista as opções e não marca escolha. Quem decide é o
  dono do projeto.
- O número é sequencial e não é reaproveitado.

## Índice

| # | Título | Status |
|---|---|---|
| [0001](./0001-registrar-decisoes-com-adr.md) | Registrar decisões de arquitetura com ADR | Aceito |
| [0002](./0002-timezone-do-usuario-apos-cadastro.md) | O timezone do usuário pode mudar depois do cadastro? | Aceito (opção A) |
| [0003](./0003-unidade-de-trabalho-por-caso-de-uso.md) | Como garantir que cada caso de uso grave tudo ou nada? | Proposto (recomendação A implementada) |
| [0004](./0004-desfazer-check-in-devolve-grace-token.md) | O que acontece com o grace fill quando o check-in que o criou é desfeito? | Proposto (recomendação A implementada) |
| [0005](./0005-politica-de-acesso-ao-habito.md) | Admin pode agir nos check-ins de outra pessoa? | Proposto (recomendação A implementada) |
