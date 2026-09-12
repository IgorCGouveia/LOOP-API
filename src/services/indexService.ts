import argon2  from 'argon2';
import {prisma} from '../app';
import jwt from 'jsonwebtoken';
import type { User } from '../generated/prisma/client';

// hash de senha descartável — só pra igualar o tempo de "usuário não existe"
// ao de "senha errada" (sem isso, o caminho sem match vaza via timing)
const DUMMY_HASH =
    "$argon2id$v=19$m=65536,t=3,p=4$JJkKO0QigvrPCY5izX8q8g$oEjzHsMUvG5zB5/peWSUhp1gOiHpeAm73oGkl+aRB+A";

// Extraído pra reaproveitar em /login e em /refresh — os dois emitem o
// mesmo shape de accessToken a partir de um User já resolvido, a única
// diferença entre as duas rotas é como o User foi resolvido (senha vs.
// refresh token).
export function signAccessToken(user: Pick<User, "id" | "role" | "name">) {
    const secretKey = process.env.SECRET_KEY;
    if (!secretKey) {
        throw new Error("Nao existe Secret Key");
    }

    return {
        accessToken: jwt.sign({ id: user.id, role: user.role }, secretKey, { expiresIn: '1h' }),
        expiresIn: "1 hora",
        name: user.name,
        id: user.id,
        role: user.role,
    };
}

export async function Logar(email: string, password: string){
    const User = await prisma.user.findUnique({
        where: {email}
    })
    if(!User){
        await argon2.verify(DUMMY_HASH, password).catch(() => false);
        return null
    }
    const verificada = await argon2.verify(User.password, password);
    if(verificada){
        return signAccessToken(User);
    }else{
        return null;
    }
}