# ADR-0004: Onde rodar as migrations em produção

- **Status:** Aceito (opção A)
- **Data:** 2026-11-20
- **Decisor:** decisão delegada pelo dono do projeto em 2026-11-20. Pendente de revisão.
- **Relacionado:** [ADR-0003](./0003-hospedar-api-na-vercel.md), [ADR-0005](./0005-conexao-pooled-e-direta-no-neon.md)

## Contexto

No Render, `prisma migrate deploy` rodava no script `start`
(`package.json:10`). Função serverless não tem etapa de start
(ADR-0003). A Vercel faz um deploy para cada push: Production para a
branch de produção e Preview para as outras branches e PRs.

## Opções consideradas

### Opção A: no build, só quando `VERCEL_ENV=production`
- Como funciona: o script `vercel-build` roda `prisma migrate deploy` antes
  do build se `VERCEL_ENV` for `production`. Em preview, pula.
- Ganha: automático. A migration sempre termina antes do código novo
  entrar no ar, e se ela falhar o build falha e o deploy não acontece.
- Perde: alguns segundos com o código antigo rodando sobre o schema novo.

### Opção B: no build, sempre
- Ganha: o mais simples.
- Perde: toda branch de preview aplica a migration dela no banco de
  produção.

### Opção C: job do GitHub Actions no push para `main`
- Ganha: separado do deploy, usa o CI que já existe.
- Perde: o job e o deploy da Vercel rodam em paralelo, sem ordem
  garantida. O código novo pode subir antes do schema. A `DIRECT_URL`
  também passa a ser secret do GitHub.

### Opção D: manual, antes do merge
- Ganha: controle total.
- Perde: depende de lembrar. Esquecer derruba produção.

## Decisão

Opção A. É a única automática que garante a ordem migration → código e
não deixa preview tocar o schema de produção.

Implementação: `package.json:11`. Comportamento conferido localmente: sem
`VERCEL_ENV` o migrate é pulado. Com `VERCEL_ENV=production` e um banco
inacessível, o build falha com `P1001` e não segue para o `tsc`.

## Consequências

- **Migrations precisam ser compatíveis com a versão anterior do código.**
  Adicionar coluna nullable ou tabela nova é seguro. Renomear ou remover
  coluna precisa de duas etapas: um deploy para o código parar de usar a
  coluna, e outro para removê-la.
- Rollback de deploy pela Vercel não desfaz a migration.
- O deploy de preview ainda **lê e escreve** no banco que estiver na
  `DATABASE_URL` do ambiente Preview. Por isso as variáveis do banco são
  configuradas só em Production (ver [guia](../guides/deploy-vercel.md)).
  Para ter preview funcional, a saída é um branch do Neon só para Preview.
