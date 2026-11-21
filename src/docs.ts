import { readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { parse } from "yaml";

// A spec é escrita à mão em docs/openapi.yaml em vez de ser gerada a partir
// de schemas nas rotas: gerar exigiria pôr JSON Schema de resposta em cada
// rota, e o Fastify usa esse schema para serializar a resposta, descartando
// campos que não estiverem nele. O teste openapi.test.ts garante que toda
// rota registrada aparece na spec. Ver doc-2/adr/0008-documentacao-openapi.md.
//
// O arquivo é lido com readFileSync(path.join(__dirname, ...)) porque a
// Vercel empacota a Function rastreando os arquivos referenciados no código,
// e esse é o padrão que o rastreador reconhece. Sem isso o YAML fica fora do
// pacote e /docs quebra só em produção. O caminho sobe um nível, então
// funciona em src/ (tsx), dist/ (build) e na Function da Vercel.

export const DOCS_PREFIX = "/docs";

// O Swagger UI vem do CDN, com versão fixa e hash de integridade (SRI), em vez
// de @fastify/swagger-ui: esse plugin depende de @fastify/static, que faz
// require() de um pacote ESM puro (content-disposition@3), e o runtime da
// Vercel não aceita isso — a Function inteira falhava ao subir.
// Para atualizar: troque a versão e recalcule os hashes com
//   curl -sL <url> | openssl dgst -sha384 -binary | base64
const SWAGGER_UI = {
    css: {
        url: "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css",
        integrity: "sha384-wxLW6kwyHktdDGr6Pv1zgm/VGJh99lfUbzSn6HNHBENZlCN7W602k9VkGdxuFvPn",
    },
    js: {
        url: "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js",
        integrity: "sha384-wmyclcVGX/WhUkdkATwhaK1X1JtiNrr2EoYJ+diV3vj4v6OC5yCeSu+yW13SYJep",
    },
};

const SWAGGER_UI_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LOOP API — documentação</title>
  <link rel="stylesheet" href="${SWAGGER_UI.css.url}" integrity="${SWAGGER_UI.css.integrity}" crossorigin="anonymous">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER_UI.js.url}" integrity="${SWAGGER_UI.js.integrity}" crossorigin="anonymous"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "${DOCS_PREFIX}/json",
      dom_id: "#swagger-ui",
      deepLinking: true,
      docExpansion: "list",
      persistAuthorization: true,
    });
  </script>
</body>
</html>
`;

export function registerDocs(server: FastifyInstance) {
    // caminho escrito inline de propósito: é a forma que o rastreador da
    // Vercel reconhece com certeza (ver comentário no topo)
    const document = parse(readFileSync(path.join(__dirname, "..", "docs", "openapi.yaml"), "utf8"));

    server.get(`${DOCS_PREFIX}/json`, async () => document);

    server.get(DOCS_PREFIX, async (_req, res) => {
        return res.type("text/html; charset=utf-8").send(SWAGGER_UI_HTML);
    });
}
