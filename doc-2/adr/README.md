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
| [0003](./0003-hospedar-api-na-vercel.md) | Onde hospedar a API e como ela sobe | Aceito (opção A) |
| [0004](./0004-migrations-no-build-de-producao.md) | Onde rodar as migrations em produção | Aceito (opção A) |
| [0005](./0005-conexao-pooled-e-direta-no-neon.md) | Conexão com o Neon: pooled para a app, direta para migrations | Aceito (opção A) |
| [0006](./0006-rate-limit-em-memoria-no-serverless.md) | Rate limit e delay de login continuam em memória no serverless | Aceito (risco aceito) |
| [0007](./0007-cookie-de-refresh-via-rewrite-no-front.md) | Cookie de refresh com front e API em domínios diferentes | Aceito (opção A) |
