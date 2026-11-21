import { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { z } from "zod";

declare module "fastify" {
    interface FastifyRequest {
        user: {
            id: string;
            role: string;
        };
    }
}

// formato do payload que signAccessToken emite. Assinatura válida não
// garante formato válido: um token sem `id` chegava aos services como
// `undefined` e virava 500 no Prisma.
const TokenPayloadVal = z.object({
    id: z.string().min(1),
    role: z.enum(["USER", "ADMIN"]),
});

// só HS256, o algoritmo que signAccessToken usa. Fixar a lista impede que
// o header do token escolha o algoritmo de verificação.
const ACCEPTED_ALGORITHMS: jwt.Algorithm[] = ["HS256"];

export default class Auth{

    constructor(){}

    user = async (req: FastifyRequest,res: FastifyReply): Promise<boolean> =>{
    const bearer = req.headers.authorization;

    if(!bearer){
        res.status(401).send({ error: "Token não informado." });
        return false;
    }

    // RFC 6750: `Bearer <token>`, esquema sem diferença de caixa. Antes o
    // esquema era ignorado e `Basic <jwt>` também passava.
    const [scheme, token, ...rest] = bearer.trim().split(/\s+/);

    if(scheme.toLowerCase() !== "bearer" || rest.length > 0){
        res.status(401).send({ error: "Header Authorization inválido. Use: Bearer <token>." });
        return false;
    }

    if(!token){
        res.status(401).send({ error: "Não autorizado. Sem token." });
        return false;
    }

    const secretKey = process.env.SECRET_KEY;

    if(!secretKey){
        // não vaza "sem chave secreta" pro cliente — é erro de configuração
        // do servidor, mesma regra do errorHandler central pra qualquer 500.
        res.status(500).send({ error: "Erro de configuração do servidor." });
        return false;
    }

    let decoded: unknown;
    try{
        decoded = jwt.verify(token, secretKey, { algorithms: ACCEPTED_ALGORITHMS });
    }catch{
        res.status(401).send({ error: "Token inválido ou expirado." });
        return false;
    }

    const payload = TokenPayloadVal.safeParse(decoded);
    if(!payload.success){
        res.status(401).send({ error: "Token inválido ou expirado." });
        return false;
    }

    req.user = {
        id: payload.data.id,
        role: payload.data.role,
    };

    return true;
}

admin = async (req: FastifyRequest, res:FastifyReply) =>{
// tem que ser arrow function para quando o fastify guardar a função o this.user() não sair como undefined
// sem o arrow admin() perderia o bind ao ser chamada
    const autenticado = await this.user(req,res);
    if(!autenticado) return;

    if(req.user.role != "ADMIN"){
        return res.status(403).send({ error: "Você não tem permissão." })
    }

}

}

