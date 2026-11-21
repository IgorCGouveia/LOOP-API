import { readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { parse } from "yaml";

// A spec é escrita à mão em docs/openapi.yaml (modo estático) em vez de ser
// gerada a partir de schemas nas rotas: gerar exigiria pôr JSON Schema de
// resposta em cada rota, e o Fastify usa esse schema para serializar a
// resposta, descartando campos que não estiverem nele. O teste
// openapi.test.ts garante que toda rota registrada aparece na spec.
// Ver doc-2/adr/0003-documentacao-openapi.md.
//
// O arquivo é lido aqui com readFileSync(path.join(__dirname, ...)) em vez de
// passar o caminho para o plugin: a Vercel empacota a Function rastreando os
// arquivos referenciados no código, e esse padrão é o que o rastreador
// reconhece. Sem isso o YAML fica fora do pacote e /docs quebra em produção.
// O caminho sobe um nível, então funciona em src/ (tsx), dist/ (build) e na
// Function da Vercel.
export const OPENAPI_SPEC_PATH = path.join(__dirname, "..", "docs", "openapi.yaml");

export const DOCS_PREFIX = "/docs";

export function registerDocs(server: FastifyInstance) {
    const document = parse(readFileSync(path.join(__dirname, "..", "docs", "openapi.yaml"), "utf8"));

    server.register(swagger, {
        mode: "static",
        specification: { document },
    });

    server.register(swaggerUi, {
        routePrefix: DOCS_PREFIX,
        uiConfig: { docExpansion: "list", deepLinking: true },
    });
}
