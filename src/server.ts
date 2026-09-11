import "dotenv/config";
import { validateSecretKey } from "./config/secretKey";
import { buildApp } from "./app";

// Guard de boot: falha alto antes de subir o servidor se a SECRET_KEY não
// estiver forte o suficiente. Camada extra — `Auth.ts` e o login mantêm a
// checagem lazy como defesa em profundidade.
try {
    validateSecretKey(process.env.SECRET_KEY);
} catch (err) {
    console.error(`[boot] configuração inválida: ${(err as Error).message}`);
    process.exit(1);
}

const server = buildApp();

const port = Number(process.env.PORT) || 3333;
const host = process.env.HOST || "0.0.0.0";

server.listen({ port, host }).catch((err) => {
    server.log.error(err);
    process.exit(1);
});
