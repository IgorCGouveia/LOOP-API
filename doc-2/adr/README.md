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
| 0003–0007 | Reservados para os ADRs de deploy do branch `IgorCGouveia/Deploy`, ainda não integrado | — |
| [0008](./0008-fastify-como-framework-http.md) | Fastify como framework HTTP | Aceito (retroativo) |
| [0009](./0009-prisma-como-orm.md) | Prisma como ORM | Aceito (retroativo) |
| [0010](./0010-postgresql-como-banco.md) | PostgreSQL como banco de dados | Aceito (retroativo) |
| [0011](./0011-autenticacao-jwt-e-refresh-em-cookie.md) | Autenticação com JWT curto e refresh token opaco em cookie | Aceito (retroativo) |
| [0012](./0012-desenho-das-rotas-usuarios-e-habitos.md) | Desenho das rotas de usuários, hábitos e check-ins | Aceito (retroativo) |

## ADRs retroativos

Os ADRs 0008 a 0012 registram decisões tomadas antes de existir este
registro. O raciocínio original ficava no `DECISIONS.md`, que foi
removido do histórico. Por isso:

- O contexto foi reconstruído a partir do código, com arquivo, linha e
  commit.
- Quando o motivo da escolha não está escrito em lugar nenhum, o ADR diz
  que ele é inferido.
- As alternativas são as que uma revisão compararia hoje, não
  necessariamente as que foram avaliadas na época.
