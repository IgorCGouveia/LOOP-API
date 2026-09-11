import { FastifyInstance } from "fastify";
import CheckinController from "../controllers/CheckinController";
import Auth from "../Middleware/Auth";

const checkinController = new CheckinController();

const auth = new Auth();

export async function checkinRoutes(server: FastifyInstance){

    server.post("/habits/:habitId/checkin", {preHandler: auth.user}, checkinController.CreateCheckIn);

    server.delete("/habits/:habitId/checkin", {preHandler: auth.user}, checkinController.UndoCheckIn);

    server.get("/habits/:habitId/checkins", {preHandler: auth.user}, checkinController.GetHabitCheckIns);

    server.get("/users/:userId/checkins", {preHandler: auth.user}, checkinController.GetUserCheckIns);
}
