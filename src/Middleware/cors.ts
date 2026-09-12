import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";

// Origem configurável por env var (CORS_ORIGIN, lista separada por
// vírgula) — nunca "*": credentials: true (obrigatório pro cookie de
// refresh chegar em requests cross-site do loop-web) proíbe wildcard por
// spec do CORS, e o navegador rejeita a combinação silenciosamente.
// Sem CORS_ORIGIN definida, cai num default de dev (localhost) — nunca
// abre geral por omissão.
const DEFAULT_DEV_ORIGINS = ["http://localhost:5173", "http://localhost:3000"];

function resolveOrigins(): string[] {
    const configured = process.env.CORS_ORIGIN;
    if (!configured) return DEFAULT_DEV_ORIGINS;
    return configured.split(",").map((origin) => origin.trim()).filter(Boolean);
}

export function registerCors(server: FastifyInstance) {
    server.register(cors, {
        origin: resolveOrigins(),
        credentials: true,
    });
}
