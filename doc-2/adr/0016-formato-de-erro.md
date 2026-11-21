# ADR-0016: Qual o formato do corpo de erro da API?

- **Status:** Proposto
- **Data:** 2026-11-20
- **Decisor:** dono do projeto
- **Relacionado:** [revisão de design](../proposals/design-review-2026-11-20.md#42-problemas), [ADR-0017](./0017-paginacao.md)

## Contexto

A API devolve quatro formatos de erro diferentes (conferido em `e49d0ef`):

| Origem | Corpo |
|---|---|
| Controllers e os demais 4xx do `errorHandler` (`P2002`, `P2025`, erros do Fastify) | `{ "error": "<frase em português>" }` |
| Zod (`errorHandler.ts:48-52`) | `{ "error": "Dados inválidos.", "details": [{ "campo", "message" }] }` |
| 500 e 429 (`errorHandler.ts:72-82`, `rateLimit.ts`) | `{ "statusCode", "error", "reqId" }` |
| 404 de rota inexistente (padrão do Fastify) | `{ "message", "error", "statusCode" }` |

Fatos que pesam na escolha:

- O cliente só tem a frase em português para distinguir erros com o
  mesmo status (ex.: os vários `403`, ou "Email já cadastrado." versus
  outros `409`). Revisar o texto quebra o cliente.
- `details` mistura chave em português (`campo`) e em inglês (`message`).
- Mobile e `loop-web` ainda estão em construção. Mudar agora custa menos
  do que depois.
- Desde o PR #28, o `errorHandler` já respeita o `statusCode` dos erros
  do Fastify (JSON malformado vira `400`, não `500`). O 404 de rota
  inexistente ainda não passa por ele: precisa de `setNotFoundHandler`
  em qualquer opção.

## Opções consideradas

### Opção A: manter `{ error }` e adicionar `code`
```json
{ "error": "Hábito não encontrado.", "code": "HABIT_NOT_FOUND", "reqId": "req-7",
  "details": [{ "field": "name", "message": "..." }] }
```
- Muda no contrato: adiciona campos. Quem lê só `error` continua funcionando.
- Precisa de migração: não.
- Ganha: mudança pequena e compatível. O cliente passa a decidir por `code`.
- Perde: formato próprio, sem ferramenta pronta que entenda.

### Opção B: RFC 9457 (Problem Details, `application/problem+json`)
```json
{ "type": "https://loop-api/errors/habit-not-found", "title": "Hábito não encontrado.",
  "status": 404, "detail": "...", "instance": "/v1/habits/abc", "reqId": "req-7",
  "errors": [{ "pointer": "#/name", "detail": "..." }] }
```
- Muda no contrato: troca o corpo inteiro e o `Content-Type`. Faz sentido entrar junto com o `/v1`.
- Precisa de migração: não.
- Ganha: padrão IETF, reconhecido por gateways, geradores de cliente OpenAPI e bibliotecas HTTP.
- Perde: quebra os clientes atuais (ou exige manter os dois formatos durante a transição). `type` precisa de URIs estáveis.

### Opção C: manter como está e só unificar os quatro formatos em `{ error, reqId }`
- Muda no contrato: pouco.
- Ganha: o mínimo de trabalho.
- Perde: continua sem código estável. O cliente continua comparando strings.

## Decisão

<Pendente.>

## Consequências

<Preencher quando aceito.>
