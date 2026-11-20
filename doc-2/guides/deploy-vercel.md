# Guia: deploy na Vercel + Neon

Passo a passo para colocar a API e o `loop-web` no ar. As decisões por
trás de cada passo estão nos ADRs
[0003](../adr/0003-hospedar-api-na-vercel.md) a
[0007](../adr/0007-cookie-de-refresh-via-rewrite-no-front.md).

URL de produção da API: `<URL_DA_API>` (preencher depois do primeiro deploy).
URL do front: `<URL_DO_FRONT>`.

## 1. Neon

1. No painel do projeto, clique em **Connect** e copie a connection string.
2. Monte as duas URLs:
   - **Pooled** (host com `-pooler`) → `DATABASE_URL`
   - **Direta** (mesmo host, sem `-pooler`) → `DIRECT_URL`
3. Nas duas, deixe só `?sslmode=require`, sem `&channel_binding=require`
   ([ADR-0005](../adr/0005-conexao-pooled-e-direta-no-neon.md)).

Nunca cole a senha em chat, issue ou commit. Se vazar, gere outra em
**Roles → Reset password**.

## 2. Projeto da API na Vercel

1. **Add New → Project**, importe o repositório `LOOP-API`.
2. Não mude nada nas configurações de build. O `vercel.json` da raiz já
   define framework, build command e output.
3. Em **Settings → Environment Variables**, cadastre as variáveis
   **marcando só o ambiente Production**:

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | URL pooled do Neon |
   | `DIRECT_URL` | URL direta do Neon |
   | `SECRET_KEY` | saída de `openssl rand -base64 48` (mínimo 32 caracteres) |
   | `NODE_ENV` | `production` |
   | `CORS_ORIGIN` | `<URL_DO_FRONT>` |

   Ficar fora do Preview é de propósito: um deploy de preview não pode ler
   nem escrever no banco de produção
   ([ADR-0004](../adr/0004-migrations-no-build-de-producao.md)).
4. Faça o deploy da branch de produção. O build roda
   `prisma migrate deploy` antes de compilar. Se a migration falhar, o
   deploy é abortado.

### Conferindo

- Nos logs do build, procure o resumo do `prisma migrate deploy`
  (migrations aplicadas, ou "No pending migrations").
- `curl -i <URL_DA_API>/rota-que-nao-existe` deve responder `404` em JSON
  do Fastify.
- Faça um cadastro e um login de teste. Se falharem com erro de módulo
  nativo (`argon2`) ou de engine do Prisma nos **logs da função**, veja a
  seção "Não verificado" do
  [ADR-0003](../adr/0003-hospedar-api-na-vercel.md#consequências).
- `[boot]` ou erro de `SECRET_KEY` no log significa chave ausente, curta
  ou com valor de exemplo.

## 3. Projeto do front (`loop-web`) na Vercel

No repositório do `loop-web`, crie um `vercel.json`
([ADR-0007](../adr/0007-cookie-de-refresh-via-rewrite-no-front.md)):

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "<URL_DA_API>/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

- A segunda regra é o fallback de SPA. Só use se o front tiver rotas
  client-side.
- A URL base das chamadas do front passa a ser `/api` (ex.: `/api/login`).
  A API não muda de rota: o rewrite remove o prefixo.

## 4. Depois do primeiro deploy

- Troque `<URL_DA_API>` e `<URL_DO_FRONT>` neste guia, no `README.md` e no
  `docs/API-REFERENCE.md`.
- Verifique qual IP aparece no log da API para uma request feita pelo
  front ([ADR-0006](../adr/0006-rate-limit-em-memoria-no-serverless.md#consequências)).

## Rodar as migrations na mão

Se precisar aplicar sem deploy (ex.: o build falhou no meio):

```bash
DATABASE_URL="<url direta>" npx prisma migrate deploy
```
