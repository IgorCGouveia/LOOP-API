import { FastifyRequest, FastifyReply } from "fastify"
import { ZodError } from "zod"
import { Prisma } from "../generated/prisma";
import { buildRateLimitError } from "./rateLimit";

// models cujo unique só é violado por duas operações simultâneas no mesmo
// hábito (check-in/undo). Repetir a requisição resolve.
const HABIT_CONCURRENCY_MODELS = new Set(["GraceFill", "HabitLog"]);

// mensagem por constraint (issue #18). Antes todo P2002 virava "Email já
// cadastrado.", inclusive conflitos de check-in que nada tinham a ver
// com email.
function uniqueConflictMessage(meta: Record<string, unknown> | undefined): string {
    const model = typeof meta?.modelName === "string" ? meta.modelName : undefined;
    const target = Array.isArray(meta?.target) ? meta.target.map(String) : [String(meta?.target ?? "")];

    if (model === "User" && target.includes("email")) {
        return "Email já cadastrado.";
    }
    if (model && HABIT_CONCURRENCY_MODELS.has(model)) {
        return "Outra operação no mesmo hábito terminou antes desta. Tente de novo.";
    }
    return "Registro duplicado.";
}

// mensagem fixa por status: a mensagem original do Fastify descreve o
// parser por dentro e não segue o idioma da API.
const CLIENT_ERROR_MESSAGES: Record<number, string> = {
    400: "Corpo da requisição inválido.",
    413: "Corpo da requisição grande demais.",
    415: "Content-Type não suportado.",
};

function clientErrorStatus(error: unknown): number | null {
    const status = (error as { statusCode?: unknown } | null)?.statusCode;
    return typeof status === "number" && status >= 400 && status < 500 ? status : null;
}

export function errorHandler(error:Error, req: FastifyRequest, res: FastifyReply){

    if(error instanceof ZodError){
        // shape único de erro: sempre { error }. Validação de campo é a
        // única exceção que carrega múltiplos problemas de uma vez — em
        // vez de inventar um segundo shape pra esse caso, os detalhes por
        // campo entram em `details`, mantendo `error` presente igual a
        // todo outro erro da API (cliente nunca precisa checar o tipo do
        // corpo antes de saber ler).
        const issues = error.issues.map((issue) => ({
            campo: issue.path.join("."),
            message: issue.message,
        }));
        return res.status(400).send({ error: "Dados inválidos.", details: issues });
    }

    if(error instanceof Prisma.PrismaClientKnownRequestError){
        if(error.code === "P2002"){
            return res.status(409).send({ error: uniqueConflictMessage(error.meta) });
        }

        // registro sumiu entre a checagem e a escrita (ex.: dois DELETE
        // paralelos no mesmo hábito): o perdedor recebe 404, não 500.
        if(error.code === "P2025"){
            return res.status(404).send({ error: "Registro não encontrado." });
        }
    }

    // erro que já chega com status de cliente: os do próprio Fastify (JSON
    // malformado, Content-Type não suportado, corpo grande demais) e o
    // objeto que o @fastify/rate-limit lança quando o limite estoura. Antes
    // todos caíam no 500 abaixo, inclusive o 429 documentado.
    const clientStatus = clientErrorStatus(error);
    if(clientStatus === 429){
        return res.status(429).send(buildRateLimitError(req));
    }
    if(clientStatus !== null){
        return res.status(clientStatus).send({ error: CLIENT_ERROR_MESSAGES[clientStatus] ?? "Requisição inválida." });
    }

    // erro não previsto: loga completo no servidor (req.log carrega o reqId)
    // e devolve só uma referência pro cliente, sem a mensagem interna.
    req.log.error(error);
    return res.status(500).send({ statusCode: 500, error: "Internal Server Error", reqId: req.id });
}
