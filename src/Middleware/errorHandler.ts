import { FastifyRequest, FastifyReply } from "fastify"
import { ZodError } from "zod"
import { Prisma } from "../generated/prisma";

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

    if(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"){
        return res.status(409).send({ error: "Email já cadastrado." });
    }

    // erro não previsto: loga completo no servidor (req.log carrega o reqId)
    // e devolve só uma referência pro cliente, sem a mensagem interna.
    req.log.error(error);
    return res.status(500).send({ statusCode: 500, error: "Internal Server Error", reqId: req.id });
}