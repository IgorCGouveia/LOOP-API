import type { IncomingMessage, ServerResponse } from "node:http";
import { validateSecretKey } from "../src/config/secretKey";
import { buildApp } from "../src/app";

// Entrypoint da Vercel Function. Substitui o `src/server.ts` só em produção
// na Vercel: lá não existe `listen()` — a plataforma recebe o request HTTP e
// entrega pra este handler. `src/server.ts` continua sendo o entrypoint de
// dev local e de qualquer host com processo de longa duração.
//
// O app é construído no escopo do módulo, fora do handler: com Fluid compute
// a mesma instância atende vários requests, então Fastify, plugins e o
// PrismaClient são inicializados uma vez por instância, não por request.

// Mesmo guard de boot do server.ts: se a SECRET_KEY for fraca, a função
// falha no cold start em vez de subir aceitando tokens assinados com chave ruim.
validateSecretKey(process.env.SECRET_KEY);

const app = buildApp();

export default async function handler(req: IncomingMessage, res: ServerResponse) {
    await app.ready();
    app.server.emit("request", req, res);
}
