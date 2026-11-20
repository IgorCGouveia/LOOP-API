// Entrypoint serverless da Vercel. Em vez de `listen()` (server.ts), cada
// invocação repassa o request Node cru para o servidor HTTP interno do
// Fastify. A instância fica no escopo do módulo para ser reaproveitada entre
// invocações da mesma instância (Fluid compute), evitando refazer o registro
// de plugins/rotas e reabrir conexões do Prisma a cada request.
//
// JS puro apontando pro `dist/` compilado pelo `npm run build`, para não
// depender do compilador TS da Vercel lidar com o `rootDir: "src"` do tsconfig.
const { validateSecretKey } = require("../dist/config/secretKey.js");
const { buildApp } = require("../dist/app.js");

// Mesmo guard de boot do server.ts. Aqui ele lança em vez de dar
// `process.exit`, e a função responde 500 com o motivo no log.
validateSecretKey(process.env.SECRET_KEY);

const app = buildApp();
const ready = app.ready();

module.exports = async function handler(req, res) {
    await ready;
    app.server.emit("request", req, res);
};
