import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { DOCS_PREFIX } from "../docs";

// A spec em docs/openapi.yaml é escrita à mão. Este teste é o que impede ela
// de ficar para trás: toda rota registrada no Fastify precisa aparecer na
// spec, e a spec não pode documentar rota que não existe.

type OpenApiDoc = {
    openapi: string;
    paths: Record<string, Record<string, unknown>>;
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

// "/habits/:habitId/checkin" -> "/habits/{habitId}/checkin"
function toOpenApiPath(url: string): string {
    return url.replace(/:(\w+)/g, "{$1}");
}

describe("documentação OpenAPI", () => {
    let app: FastifyInstance;
    const registered = new Set<string>();

    beforeAll(async () => {
        app = buildApp();
        app.addHook("onRoute", (route) => {
            if (route.url.startsWith(DOCS_PREFIX)) return;
            const methods = Array.isArray(route.method) ? route.method : [route.method];
            for (const method of methods) {
                const m = method.toLowerCase();
                if (HTTP_METHODS.includes(m)) {
                    registered.add(`${m} ${toOpenApiPath(route.url)}`);
                }
            }
        });
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    async function fetchSpec(): Promise<OpenApiDoc> {
        const res = await app.inject({ method: "GET", url: `${DOCS_PREFIX}/json` });
        expect(res.statusCode).toBe(200);
        return res.json() as OpenApiDoc;
    }

    function documented(spec: OpenApiDoc): Set<string> {
        const ops = new Set<string>();
        for (const [path, item] of Object.entries(spec.paths)) {
            for (const method of Object.keys(item)) {
                if (HTTP_METHODS.includes(method)) ops.add(`${method} ${path}`);
            }
        }
        return ops;
    }

    it("serve a spec em /docs/json e a interface em /docs", async () => {
        const spec = await fetchSpec();
        expect(spec.openapi).toMatch(/^3\./);

        const ui = await app.inject({ method: "GET", url: `${DOCS_PREFIX}/` });
        expect(ui.statusCode).toBe(200);
        expect(ui.headers["content-type"]).toContain("text/html");
    });

    it("toda rota registrada está documentada", async () => {
        // sem isto, um hook que não pegou nenhuma rota passaria vazio
        expect(registered.size).toBeGreaterThan(0);
        const docs = documented(await fetchSpec());
        const missing = [...registered].filter((op) => !docs.has(op));
        expect(missing).toEqual([]);
    });

    it("a spec não documenta rota que não existe", async () => {
        const docs = documented(await fetchSpec());
        const extra = [...docs].filter((op) => !registered.has(op));
        expect(extra).toEqual([]);
    });
});
