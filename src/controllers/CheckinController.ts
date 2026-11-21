import { FastifyReply, FastifyRequest } from "fastify";
import * as checkinService from "../services/checkinServices";


export default class CheckinController{

    constructor(){}

    // acesso ao hábito já conferido por requireHabitAccess (rota); o
    // hábito carregado vem em req.habit.
    async CreateCheckIn(req: FastifyRequest, res: FastifyReply){
        const habit = req.habit;

        const result = await checkinService.CreateCheckIn(habit.id, habit.userId);
        if(result == null){
            return res.status(404).send({ error: "Hábito ou usuário não encontrado." });
        }

        return res.status(201).send({ message: "Check-in registrado com sucesso.", data: result });
    }


    async UndoCheckIn(req: FastifyRequest, res: FastifyReply){
        const result = await checkinService.UndoCheckIn(req.habit.id);
        if(result == null){
            return res.status(400).send({ error: "Nenhum check-in para desfazer." });
        }

        return res.status(200).send({
            message: "Check-in desfeito com sucesso.",
            data: result
        });
    }


    async GetHabitCheckIns(req: FastifyRequest, res: FastifyReply){
        const checkins = await checkinService.GetCheckInsByHabit(req.habit.id);
        return res.status(200).send({ message: "Check-ins encontrados.", data: checkins });
    }


    async GetUserCheckIns(req: FastifyRequest, res: FastifyReply){
        const { userId } = req.params as { userId: string };

        if(req.user.id !== userId && req.user.role !== "ADMIN"){
            return res.status(403).send({ error: "Você não tem permissão para ver os check-ins de outra pessoa." });
        }

        const checkins = await checkinService.GetCheckInsByUser(userId);
        if(checkins == null){
            return res.status(404).send({ error: "Usuário não encontrado." });
        }

        return res.status(200).send({ message: "Check-ins encontrados.", data: checkins });
    }

}
