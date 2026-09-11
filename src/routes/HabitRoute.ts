import { FastifyInstance } from "fastify";
import HabitController from "../controllers/HabitController";
import  Auth  from "../Middleware/Auth";

const habitController = new HabitController();

const auth = new Auth();

export async function habitRoutes(server: FastifyInstance){



    server.post("/habits", {preHandler: auth.user}, habitController.CreateHabit);

    server.get("/me/habits", {preHandler: auth.user}, habitController.GetMyHabits);

    server.get("/users/:userId/habits", {preHandler: auth.user}, habitController.GetAllFromUser);

    server.get("/habits", {preHandler: auth.admin}, habitController.GetAllHabits);

    server.patch("/habits/:id", {preHandler: auth.user}, habitController.UpdateHabit);

    server.delete("/habits/:id", {preHandler: auth.user}, habitController.DeleteHabit);
}

