# Referência

## Contrato HTTP

A referência atual é [`docs/API-REFERENCE.md`](../../docs/API-REFERENCE.md).
Ela ainda não foi migrada para cá. Copiar o conteúdo agora criaria duas
fontes que iam divergir.

O padrão de mercado para isso é uma especificação **OpenAPI 3** gerada a
partir das rotas, por exemplo com `@fastify/swagger` mais os schemas Zod.
Assim a doc não fica desatualizada em relação ao código. Isso adiciona
uma dependência nova, então só entra se for aprovado.

### Divergências conhecidas entre a doc e o código

Nenhuma aberta no momento.

Resolvidas:

| Seção | Divergência | Resolução |
|---|---|---|
| `PATCH /users/:id` e "Fuso horário mostrado pro usuário" | A doc se contradizia: uma seção aceitava `timezone` no PATCH e outra dizia que ele não mudava. O código aceitava. | Issue #15, [ADR-0002](../adr/0002-timezone-do-usuario-apos-cadastro.md). O código passou a rejeitar, e as duas seções foram alinhadas. |

## Configuração (variáveis de ambiente)

| Variável | Obrigatória | Uso |
|---|---|---|
| `DATABASE_URL` | sim | Conexão com o PostgreSQL |
| `SECRET_KEY` | sim | Assinatura do JWT. O boot falha se ela estiver ausente, curta ou com valor de exemplo (`src/config/secretKey.ts`). |
| `CORS_ORIGIN` | não | Origens liberadas, separadas por vírgula. Só o `loop-web` precisa. |
| `PORT` / `HOST` | não | Padrão `3333` / `0.0.0.0` |
