import { FastifyRequest, FastifyReply } from "fastify"
import { ZodError } from "zod"
import { Prisma } from "../generated/prisma";

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

    // erro não previsto: loga completo no servidor (req.log carrega o reqId)
    // e devolve só uma referência pro cliente, sem a mensagem interna.
    req.log.error(error);
    return res.status(500).send({ statusCode: 500, error: "Internal Server Error", reqId: req.id });
}
