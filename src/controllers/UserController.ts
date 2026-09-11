import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../app";
import { CreateUserVal, UpdateUserVal } from "../schema/userVal";
import * as userService from "../services/userServices"


export default class UserController{

    constructor(){}

    async CreateUser(req:FastifyRequest, res:FastifyReply){    
        
        
        const data = CreateUserVal.parse(req.body);
        
        //vai chamar o service para criar um usuario
        const NewUser = await userService.createUser(data);

        return res.status(201).send(NewUser);
    }





    async GetAll(req:FastifyRequest, res:FastifyReply){
        const users = await userService.getAllusers();
        return res.status(200).send(users);
    
    }





    async update(req:FastifyRequest, res:FastifyReply){

        const { id } = req.params as {id: string};

        const user = await userService.FindUser(id);

        if(user == null){
            return res.status(404).send("User not found");
        }

        if(req.user.id === id){
            const data = UpdateUserVal.parse(req.body);

            if( Object.keys(data).length == 0){
            return res.status(400).send("Nenhum dado para atualizar foi fornecido");
        }

        const userUp = await userService.updateUser(id, data);

        return res.status(200).send(userUp);
        }



        
        return res.status(403).send("Você não tem permissão para mudar esse usuario.");
    }






    async delUser(req:FastifyRequest, res:FastifyReply){
        const {id} = req.params as {id: string};

        const USER = await userService.FindUser(id);

        if(USER == null){
            return res.status(404).send("user Not Found!");
        }
        const role = USER.role;

        if(req.user.id === id || (req.user.role == "ADMIN" && role != "ADMIN")){

            
            const deletado = await userService.delUser(id);
            return res.status(200).send(deletado); 
        }
        return res.status(403).send("Você não pode deletar o perfil de outra pessoa"); 
    }
}

