# ADR-0003: Como manter a spec OpenAPI junto com o código?

- **Status:** Aceito (opção A)
- **Data:** 2026-11-20
- **Decisor:** dono do projeto
- **Relacionado:** [reference/README.md](../reference/README.md), [ADR-0001](./0001-registrar-decisoes-com-adr.md)

## Contexto

O dono do projeto pediu documentação OpenAPI/Swagger das rotas. Até aqui o
contrato HTTP vivia só em `docs/API-REFERENCE.md`, em prosa.

Fatos do código, conferidos no commit `b8700bb`:

- Nenhuma rota declara `schema` no Fastify. A validação é feita com Zod
  dentro dos controllers (`src/controllers/UserController.ts:15`,
  `src/controllers/HabitController.ts:13`).
- Quando uma rota declara `schema.response`, o Fastify passa a serializar a
  resposta com `fast-json-stringify` e descarta qualquer campo que não
  esteja no schema. Hoje as respostas são objetos do Prisma espalhados com
  campos extras (`src/services/habitServices.ts:60`), então um schema
  incompleto removeria dados da resposta sem erro.
- São 17 operações em 4 arquivos de rota (`src/routes/`).

## Opções consideradas

### Opção A: spec estática em YAML, conferida por teste

- `docs/openapi.yaml` escrito à mão, servido por `@fastify/swagger` em modo
  `static` e `@fastify/swagger-ui` em `/docs` (`src/docs.ts`).
- `src/__tests__/openapi.test.ts` lista as rotas registradas no Fastify e
  falha se alguma não estiver na spec, ou se a spec tiver rota que não existe.
- Muda no contrato da API: duas rotas novas, `GET /docs` e `GET /docs/json`.
- Precisa de migração: não.
- Ganha: nenhum risco de mudar o corpo das respostas; a spec pode ter
  exemplos e descrições ricos; adoção num PR só.
- Perde: o teste garante que as rotas batem, mas não que os campos de
  request e response batem. Mudar um schema Zod sem mexer no YAML passa no CI.

### Opção B: spec gerada dos schemas Zod nas rotas

- Converter os schemas Zod para JSON Schema (por exemplo com
  `fastify-type-provider-zod`) e declarar `schema` em cada rota.
- Muda no contrato da API: as rotas novas de `/docs`, e possivelmente o
  formato de erro de validação, que passaria pelo Fastify em vez do
  `errorHandler` atual.
- Precisa de migração: não.
- Ganha: request e response documentados direto do código; impossível
  divergir nos campos.
- Perde: refatoração de todas as rotas e controllers; cada schema de
  resposta precisa estar completo, senão o Fastify corta campos; mais uma
  dependência.

### Opção C: só melhorar o `API-REFERENCE.md`

- Ganha: zero dependência.
- Perde: não atende o pedido (sem Swagger UI nem spec que ferramentas leiam).

## Decisão

Opção A, aceita pelo dono do projeto em 2026-11-20.

A spec fica em `docs/openapi.yaml`, escrita à mão, e é servida em `/docs`
(Swagger UI) e `/docs/json` por `@fastify/swagger` em modo `static` e
`@fastify/swagger-ui` (`src/docs.ts`). O teste
`src/__tests__/openapi.test.ts` falha se uma rota registrada não estiver na
spec ou se a spec tiver rota que não existe.

A opção B foi descartada por agora porque declarar `schema.response` nas
rotas faz o Fastify cortar campos que não estejam no schema, e as respostas
atuais carregam campos extras vindos do Prisma. Adotá-la com segurança
exigiria escrever um schema de resposta completo para cada rota migrada,
e testar que nenhuma resposta perdeu campos. A opção C não atende o pedido.

## Consequências

Com a opção A:

- Mudanças de campo em request ou response precisam atualizar
  `docs/openapi.yaml` no mesmo PR. A regra já existe nas convenções do
  `doc-2` ("PR que muda comportamento documentado atualiza a doc no mesmo
  PR"); o teste só cobre a lista de rotas.
- A migração para a opção B continua possível depois, rota por rota, e o
  teste de cobertura serve dos dois jeitos.
- Na Vercel, a Function só empacota os arquivos que o rastreador
  (`@vercel/nft`) encontra no código. Por isso `src/docs.ts` lê a spec com
  `readFileSync(path.join(__dirname, "..", "docs", "openapi.yaml"))` e passa
  o objeto para o plugin, em vez de passar só o caminho. Se esse trecho for
  reescrito sem o padrão `path.join(__dirname, ...)`, o YAML pode ficar fora
  do pacote e `/docs` quebra só em produção. O trace local confirmou que o
  YAML e os arquivos estáticos do Swagger UI entram no pacote.
- `docs/API-REFERENCE.md` continua como guia para quem constrói um cliente
  (fluxo de refresh, CORS, onde guardar o token). A referência campo a
  campo passa a ser a spec.
