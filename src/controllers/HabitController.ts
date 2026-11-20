import { FastifyReply, FastifyRequest } from "fastify";
import * as habitService from "../services/habitServices"
import { CreateHabitVal, UpdateHabitVal } from "../schema/habitVal";


export default class HabitController{

    constructor(){}

    async CreateHabit(req:FastifyRequest, res:FastifyReply){
        const userId = req.user.id;
        const body = req.body as { name: string; description?: string; schedule?: unknown };
        const data = CreateHabitVal.parse({
            name: body.name,
            description: body.description,
            schedule: body.schedule,
            userId,
        });

        //vai chamar o service para criar um usuario
        const NewHabit = await habitService.CreateHabit(data);

        return res.status(201).send({ message: "Hábito criado com sucesso.", data: NewHabit });
    }


    async GetMyHabits(req: FastifyRequest, res: FastifyReply){
        const habits = await habitService.GetAllHabitsFromUser(req.user.id);
        return res.status(200).send({ message: "Hábitos encontrados.", data: habits });
    }


    async GetAllFromUser(req:FastifyRequest, res:FastifyReply){
        const {userId} = req.params as {userId:string};

        if(req.user.id !== userId && req.user.role !== "ADMIN"){
            return res.status(403).send({ error: "Você não tem permissão para ver os hábitos de outra pessoa." })
        }

        const habits = await habitService.GetAllHabitsFromUser(userId);
        if(!habits){
            return res.status(404).send({ error: "Usuário ou hábitos não encontrados." });
        }
            return res.status(200).send({ message: "Hábitos encontrados.", data: habits });

        }



    async GetAllHabits(req: FastifyRequest, res:FastifyReply){

        if(req.user.role === "ADMIN"){
        const habits = await habitService.GetAllHabits();
        return res.status(200).send({ message: "Hábitos encontrados.", data: habits });
        }
        return res.status(403).send({ error: "Você não tem permissão para ver os hábitos de outra pessoa." })
    }


    // acesso ao hábito já conferido por requireHabitAccess (rota); o
    // hábito carregado vem em req.habit.
    async UpdateHabit(req:FastifyRequest, res: FastifyReply){
        const data = UpdateHabitVal.parse(req.body);
        if(Object.keys(data).length == 0){
            return res.status(400).send({ error: "Nenhum dado para atualizar foi fornecido." });
        }

        const habitUpdate = await habitService.UpdateHabit(req.habit, data)
        return res.status(200).send({
            message: "Hábito atualizado com sucesso.",
            data: habitUpdate
        })
    }


    async DeleteHabit(req: FastifyRequest, res: FastifyReply){
        const deleted = await habitService.DeleteHabit(req.habit.id);
        return res.status(200).send({
            message: "Hábito apagado com sucesso.",
            data: deleted
        })
    }

}
