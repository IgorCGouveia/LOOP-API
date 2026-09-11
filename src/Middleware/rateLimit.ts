import type { FastifyInstance, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";

// Shape único do 429, reaproveitado pelo layer de IP (abaixo) e pelo cap de
// concorrência no handler de /login — mesmo formato dos 500 do errorHandler.
export function buildRateLimitError(request: FastifyRequest) {
    return {
        statusCode: 429,
        error: "Too Many Requests",
        reqId: request.id,
    };
}

// Layer de IP. global: false — cada rota opta via config.rateLimit, não herda.
export function registerRateLimit(server: FastifyInstance) {
    server.register(rateLimit, {
        global: false,
        errorResponseBuilder: (request) => buildRateLimitError(request),
    });
}
