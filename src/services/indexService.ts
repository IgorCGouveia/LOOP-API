import argon2  from 'argon2';
import {prisma} from '../app';
import jwt from 'jsonwebtoken';

// hash de senha descartável — só pra igualar o tempo de "usuário não existe"
// ao de "senha errada" (sem isso, o caminho sem match vaza via timing)
const DUMMY_HASH =
    "$argon2id$v=19$m=65536,t=3,p=4$JJkKO0QigvrPCY5izX8q8g$oEjzHsMUvG5zB5/peWSUhp1gOiHpeAm73oGkl+aRB+A";

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

        const payload = {
            id: User.id,
            role: User.role,
        };

        const secretKey = process.env.SECRET_KEY

        if(secretKey){
            const Auth =  {
                accessToken: jwt.sign(payload, secretKey, {expiresIn: '1h'}),
                expiresIn: "1 hora",
                name: User.name,
                id: User.id,
                role: User.role
            };

            return Auth;
        }else{
            throw new Error("Nao existe Secret Key");
        }   
    }else{
        return null;
    }


}