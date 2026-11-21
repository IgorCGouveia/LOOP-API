# ADR-0014: O que exigir para trocar senha ou email

- **Status:** Proposto
- **Data:** 2026-11-20
- **Decisor:** dono do projeto
- **Relacionado:** [auditoria de segurança, achado H3](../investigations/auditoria-seguranca-2026-11-20.md#h3-troca-de-senha-e-email-sem-a-senha-atual-e-sem-derrubar-sessões),
  [ADR-0002](./0002-timezone-do-usuario-apos-cadastro.md) (a allowlist do `UpdateUserVal`),
  [ADR-0006](./0006-autenticacao-jwt-e-refresh-em-cookie.md) (JWT curto e refresh em cookie)

## Contexto

`PATCH /users/:id` aceita `name`, `email`, `password` e `confirmPassword`
(`src/schema/userVal.ts:48-61`, conferido em `e49d0ef`). Para mudar qualquer um deles basta o
access token do próprio usuário (`src/controllers/UserController.ts:45`).
Não há pedido da senha atual.

Quando a senha muda, `updateUser` grava o hash novo
(`src/services/userServices.ts:51-59`) e não mexe na tabela
`RefreshToken`. Os refresh tokens já emitidos continuam valendo até
expirar (7 dias, `src/services/refreshTokenServices.ts:6`).

Consequências disso:
- Um access token roubado (válido por 1h) basta para trocar email e senha
  e ficar com a conta.
- Trocar a senha não expulsa quem já tem um refresh token da vítima.

Referência de mercado: o OWASP ASVS 4.0 pede a senha atual para trocar a
senha (V2.1.6) e pede que trocar a senha permita encerrar as outras
sessões (V3.3).

Não existe envio de email no projeto hoje.

## Opções consideradas

### Opção A: senha atual para senha e email, e revogar sessões na troca de senha
- Como funciona: novo campo `currentPassword`, obrigatório quando o body
  traz `password` ou `email`, conferido com `argon2.verify`. Na troca de
  senha, `refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })`
  na mesma transação do update.
- Muda no contrato da API: `PATCH /users/:id` passa a exigir
  `currentPassword` nesses dois casos. `name` continua livre. O
  `loop-web` precisa de um campo de senha atual na tela de perfil.
- Precisa de migração: não.
- Ganha: fecha os dois problemas do contexto.
- Perde: o email continua trocável sem confirmar que o endereço novo é da
  pessoa.

### Opção B: senha atual só para a senha, e revogar sessões na troca de senha
- Como funciona: igual à A, mas `email` continua mudando só com o token.
- Muda no contrato da API: `currentPassword` obrigatório só com
  `password`.
- Precisa de migração: não.
- Ganha: muda menos o front.
- Perde: quem tem o token troca o email. Se um dia existir recuperação de
  senha por email, isso vira tomada de conta completa.

### Opção C: opção A mais confirmação do email novo por link
- Como funciona: o email novo fica pendente até o usuário clicar num link
  enviado para ele.
- Muda no contrato da API: o PATCH de email deixa de ser imediato, e
  surge uma rota de confirmação.
- Precisa de migração: sim (email pendente, token de confirmação).
- Ganha: é o fluxo completo de mercado.
- Perde: exige um provedor de envio de email, que é dependência e serviço
  novos.

### Opção D: só revogar sessões na troca de senha
- Como funciona: sem `currentPassword`. Só a revogação.
- Muda no contrato da API: nada.
- Precisa de migração: não.
- Ganha: zero mudança no front.
- Perde: um token roubado continua bastando para trocar a senha.

## Decisão

<Preencher quando o status for Aceito.>

## Consequências

- Em todas as opções, a troca de senha também deveria devolver um refresh
  token novo para a sessão atual, ou o próprio usuário é deslogado no
  próximo `/refresh`. Isso tem que ser decidido junto.
- Testes: PATCH sem `currentPassword` (quando exigido) responde 400 ou
  401; com a senha atual errada, 401; depois da troca, `/refresh` com o
  cookie antigo responde 401.
- `docs/API-REFERENCE.md` (seção `PATCH /users/:id`) muda no mesmo PR.
