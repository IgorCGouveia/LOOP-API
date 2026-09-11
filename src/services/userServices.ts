import argon2 from "argon2";
import { prisma } from "../app";
import { CreateUserInput, UpdateUserInput } from "../schema/userVal";


export async function FindUser(id: string){
    const user = await prisma.user.findUnique({
        where: {id},
        select: {id: true, email: true, name: true, role: true}
        });    

    if(!user){
        return null
    }
    return user;
}


export async function createUser(data: CreateUserInput){
        const hash = await argon2.hash(data.password, {
            type: argon2.argon2id,
            memoryCost: 2 ** 16,
            timeCost: 3,
            parallelism: 1,
        });

        const user = await prisma.user.create({
            data: {
                name: data.name,
                email: data.email,
                password: hash,
                timezone: data.timezone,
            },
            select: {id: true, email: true, name: true, role: true}
        });
        return user;
}

export async function getAllusers(){
    const users = await prisma.user.findMany({
        orderBy: { id: "asc" },
        select: {id: true, email: true, name: true, role: true},
    });
    return users;
}

export async function updateUser(id: string, data: UpdateUserInput){
    const payload: any = {};
    if(data.name !== undefined) payload.name = data.name;
    if(data.email !== undefined) payload.email = data.email;
    if(data.timezone !== undefined) payload.timezone = data.timezone;
    if(data.password !== undefined){
        payload.password = await argon2.hash(data.password, {
            type: argon2.argon2id,
            memoryCost: 2**16,
            timeCost: 3,
            parallelism: 1,

        });
    }
    
    
    const user = await prisma.user.update({
        where: {id},
        data: payload,
        select: {id: true, email: true, name: true, role: true}
    });
    return user;
}



export async function delUser(id: string){
    const deleted = await prisma.user.delete({
        where: { id },
        select: {id: true, email: true, name: true, role: true}
    });
    return deleted;

    //se nao usasse o onDelete: Cascade no schema do banco de dados ficaria assim:
    // await prisma.$transaction([ <- garante consistencia para várias operações atomicas no banco
    //     prisma.habit.deleteMany({
    //         where: {userId: id},
    //     }),
    //     prisma.user.delete({
    //         where: {id: id}
    //     })
    // ])
}