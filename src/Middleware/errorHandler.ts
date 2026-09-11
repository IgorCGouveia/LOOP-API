import { FastifyRequest, FastifyReply } from "fastify"
import { ZodError } from "zod"
import { Prisma } from "../generated/prisma";

export function errorHandler(error:Error, req: FastifyRequest, res: FastifyReply){

    if(error instanceof ZodError){
        const issues = error.issues.map((issue) => ({
            campo: issue.path.join("."),
            message: issue.message,
        }));
        return res.status(400).send(issues);
    }

    if(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"){
        return res.status(409).send({message: "Email já cadastrado."});
    }

    // erro não previsto: loga completo no servidor (req.log carrega o reqId)
    // e devolve só uma referência pro cliente, sem a mensagem interna.
    req.log.error(error);
    return res.status(500).send({ statusCode: 500, error: "Internal Server Error", reqId: req.id });
}