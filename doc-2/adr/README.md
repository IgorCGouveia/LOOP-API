# Registro de decisões de arquitetura (ADR)

Formato de Michael Nygard. Cada arquivo registra uma decisão. Use o
[template](./template.md) para criar um novo.

## Ciclo de vida

`Proposto` → `Aceito` → (opcional) `Substituído por ADR-NNNN` ou `Descontinuado`

- Um ADR `Aceito` não é editado. Se a decisão mudar, cria-se um ADR novo
  que referencia o antigo, e o antigo muda só a linha de status.
- Um ADR `Proposto` lista as opções e não marca escolha. Quem decide é o
  dono do projeto.
- O número é sequencial e não é reaproveitado. Ele segue a ordem de
  integração na `main`: antes do merge, renumere o seu ADR para o próximo
  número livre na `main` e atualize o índice e os links no mesmo commit.
  Um ADR só tem número definitivo depois de integrado.

## Índice

| # | Título | Status |
|---|---|---|
| [0001](./0001-registrar-decisoes-com-adr.md) | Registrar decisões de arquitetura com ADR | Aceito |
| [0002](./0002-timezone-do-usuario-apos-cadastro.md) | O timezone do usuário pode mudar depois do cadastro? | Aceito (opção A) |
| [0003](./0003-fastify-como-framework-http.md) | Fastify como framework HTTP | Aceito (retroativo) |
| [0004](./0004-prisma-como-orm.md) | Prisma como ORM | Aceito (retroativo) |
| [0005](./0005-postgresql-como-banco.md) | PostgreSQL como banco de dados | Aceito (retroativo) |
| [0006](./0006-autenticacao-jwt-e-refresh-em-cookie.md) | Autenticação com JWT curto e refresh token opaco em cookie | Aceito (retroativo) |
| [0007](./0007-desenho-das-rotas-usuarios-e-habitos.md) | Desenho das rotas de usuários, hábitos e check-ins | Aceito (retroativo) |
| [0008](./0008-documentacao-openapi.md) | Como manter a spec OpenAPI junto com o código? | Aceito (opção A) |
| [0009](./0009-unidade-de-trabalho-por-caso-de-uso.md) | Como garantir que cada caso de uso grave tudo ou nada? | Proposto (recomendação A implementada) |
| [0010](./0010-desfazer-check-in-devolve-grace-token.md) | O que acontece com o grace fill quando o check-in que o criou é desfeito? | Proposto (recomendação A implementada) |
| [0011](./0011-politica-de-acesso-ao-habito.md) | Admin pode agir nos check-ins de outra pessoa? | Proposto (recomendação A implementada) |
| [0012](./0012-sessao-de-usuario-apagado.md) | O que um accessToken de conta apagada pode fazer? | Proposto |

## ADRs retroativos

Os ADRs 0003 a 0007 registram decisões tomadas antes de existir este
registro. O raciocínio original ficava no `DECISIONS.md`, que foi
removido do histórico. Por isso:

- O contexto foi reconstruído a partir do código, com arquivo, linha e
  commit.
- Quando o motivo da escolha não está escrito em lugar nenhum, o ADR diz
  que ele é inferido.
- As alternativas são as que uma revisão compararia hoje, não
  necessariamente as que foram avaliadas na época.
