# ADR-0007: Cookie de refresh com front e API em domínios diferentes

- **Status:** Aceito (opção A). Depende de mudança no repo `loop-web`.
- **Data:** 2026-11-20
- **Decisor:** decisão delegada pelo dono do projeto em 2026-11-20. Pendente de revisão.
- **Relacionado:** [ADR-0003](./0003-hospedar-api-na-vercel.md), [ADR-0006](./0006-rate-limit-em-memoria-no-serverless.md)

## Contexto

O refresh token do `loop-web` vai num cookie `httpOnly`, com
`sameSite: "none"` e `secure: true` em produção
(`src/config/cookies.ts:24-31`). O CORS libera a origem explícita do
`CORS_ORIGIN` com `credentials: true` (`src/Middleware/cors.ts`).

Front e API ficam em projetos separados na Vercel
(`<front>.vercel.app` e `<api>.vercel.app`). Como `vercel.app` está na
Public Suffix List, os dois contam como **sites diferentes**. O cookie da
API, visto pelo front, é cookie de terceiros. O Safari bloqueia por
padrão, e outros navegadores vêm restringindo. O sintoma é o login
funcionar e o `/refresh` falhar sem erro visível.

## Opções consideradas

### Opção A: rewrite no projeto do front
- Como funciona: o `vercel.json` do `loop-web` faz proxy de `/api/:path*`
  para `https://<api>.vercel.app/:path*`. O navegador só fala com o
  domínio do front, e o cookie vira de primeira parte.
- Muda no contrato da API: nada. As rotas continuam sem prefixo, porque o
  rewrite remove o `/api`.
- Muda no front: a URL base das chamadas passa a ser `/api`.
- Ganha: grátis, funciona em todos os navegadores, e o CORS deixa de ser
  necessário para o navegador.
- Perde: um salto a mais (borda do front → API). O IP do cliente que
  chega na API pelo proxy ainda não foi verificado (ver ADR-0006).

### Opção B: domínio próprio com subdomínios (`app.` / `api.`)
- Ganha: mesmo site de verdade, sem proxy.
- Perde: custa o domínio.

### Opção C: deixar como está
- Ganha: nada a fazer.
- Perde: login quebra no Safari.

## Decisão

Opção A: é a única grátis que funciona no Safari.

## Consequências

- **Pendente fora deste repositório:** criar o `vercel.json` no `loop-web`
  e trocar a URL base. Até isso acontecer, o refresh pode falhar no Safari.
  O conteúdo está no [guia de deploy](../guides/deploy-vercel.md).
- `sameSite: "none"` continua funcionando via proxy. Com o rewrite ativo,
  dá para avaliar passar para `"lax"`, que protege melhor contra CSRF.
  Isso é mudança de comportamento e precisa de novo ADR.
- O `CORS_ORIGIN` continua configurado, para chamadas diretas à API
  (ferramentas e testes a partir do domínio do front).
