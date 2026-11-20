import { FastifyInstance } from "fastify";
import CheckinController from "../controllers/CheckinController";
import Auth from "../Middleware/Auth";
import { requireHabitAccess } from "../Middleware/habitAccess";

const checkinController = new CheckinController();

const auth = new Auth();

export async function checkinRoutes(server: FastifyInstance){

    server.post("/habits/:habitId/checkin", {preHandler: [auth.user, requireHabitAccess("checkin:create")]}, checkinController.CreateCheckIn);

    server.delete("/habits/:habitId/checkin", {preHandler: [auth.user, requireHabitAccess("checkin:undo")]}, checkinController.UndoCheckIn);

    server.get("/habits/:habitId/checkins", {preHandler: [auth.user, requireHabitAccess("checkin:list")]}, checkinController.GetHabitCheckIns);

    server.get("/users/:userId/checkins", {preHandler: auth.user}, checkinController.GetUserCheckIns);
}
