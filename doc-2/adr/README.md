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
