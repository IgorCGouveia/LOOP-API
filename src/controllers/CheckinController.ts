import { FastifyReply, FastifyRequest } from "fastify";
import * as checkinService from "../services/checkinServices";
import * as habitService from "../services/habitServices";


export default class CheckinController{

    constructor(){}

    async CreateCheckIn(req: FastifyRequest, res: FastifyReply){
        const { habitId } = req.params as { habitId: string };

        const habit = await habitService.FindHabit(habitId);
        if(habit == null){
            return res.status(404).send("Hábito não encontrado.");
        }

        if(req.user.id !== habit.userId && req.user.role !== "ADMIN"){
            return res.status(403).send("Você não tem permissão para fazer check-in no hábito de outra pessoa.");
        }

        const result = await checkinService.CreateCheckIn(habitId, habit.userId);
        if(result == null){
            return res.status(404).send("Hábito ou usuário não encontrado.");
        }

        return res.status(201).send(result);
    }


    async UndoCheckIn(req: FastifyRequest, res: FastifyReply){
        const { habitId } = req.params as { habitId: string };

        const habit = await habitService.FindHabit(habitId);
        if(habit == null){
            return res.status(404).send("Hábito não encontrado.");
        }

        if(req.user.id !== habit.userId && req.user.role !== "ADMIN"){
            return res.status(403).send("Você não tem permissão para desfazer o check-in do hábito de outra pessoa.");
        }

        const result = await checkinService.UndoCheckIn(habitId);
        if(result == null){
            return res.status(400).send("Nenhum check-in para desfazer.");
        }

        return res.status(200).send({
            message: "Check-in desfeito",
            data: result
        });
    }


    async GetHabitCheckIns(req: FastifyRequest, res: FastifyReply){
        const { habitId } = req.params as { habitId: string };

        const habit = await habitService.FindHabit(habitId);
        if(habit == null){
            return res.status(404).send("Hábito não encontrado.");
        }

        if(req.user.id !== habit.userId && req.user.role !== "ADMIN"){
            return res.status(403).send("Você não tem permissão para ver os check-ins do hábito de outra pessoa.");
        }

        const checkins = await checkinService.GetCheckInsByHabit(habitId);
        return res.status(200).send(checkins);
    }


    async GetUserCheckIns(req: FastifyRequest, res: FastifyReply){
        const { userId } = req.params as { userId: string };

        if(req.user.id !== userId && req.user.role !== "ADMIN"){
            return res.status(403).send("Você não tem permissão para ver os check-ins de outra pessoa.");
        }

        const checkins = await checkinService.GetCheckInsByUser(userId);
        if(checkins == null){
            return res.status(404).send("Usuário não encontrado.");
        }

        return res.status(200).send(checkins);
    }

}
