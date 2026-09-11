import { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";

declare module "fastify" {
    interface FastifyRequest {
        user: {
            id: string;
            role: string;
        };
    }
}

type TokenPayload = {
    id: string;
    role: string;
};

export default class Auth{

    constructor(){}

    user = async (req: FastifyRequest,res: FastifyReply): Promise<boolean> =>{
    const bearer = req.headers.authorization;

    if(!bearer){
        res.status(401).send("Token não informado");
        return false;
    }

    const token = bearer.split(" ")[1];

    if(!token){
        res.status(401).send("Não autorizado. Sem Token");
        return false;
    }

    const secretKey = process.env.SECRET_KEY;

    if(!secretKey){
        res.status(500).send("Sem chave secreta");
        return false;
    }

    try{
        const autenticado = jwt.verify(token, secretKey) as TokenPayload;

        req.user = {
            id: autenticado.id,
            role: autenticado.role
        }
    }catch{
        res.status(401).send("Token inválido ou expirado");
        return false;
    }

    return true;
}

admin = async (req: FastifyRequest, res:FastifyReply) =>{
// tem que ser arrow function para quando o fastify guardar a função o this.user() não sair como undefined
// sem o arrow admin() perderia o bind ao ser chamada
    const autenticado = await this.user(req,res);
    if(!autenticado) return;

    if(req.user.role != "ADMIN"){
        return res.status(403).send("Você não tem permissão")
    }

}

}

