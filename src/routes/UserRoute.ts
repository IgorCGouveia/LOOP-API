import { FastifyInstance } from "fastify";
import UserController from "../controllers/UserController";
import Auth from "../Middleware/Auth";

const userController = new UserController();
const auth = new Auth();
export async function userRoutes(server: FastifyInstance){



    // rate limit por IP — só cadastro, sem conta pra rastrear ainda
    server.post("/users", {
        config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
    }, userController.CreateUser);

    server.get("/users", {preHandler: auth.admin}, userController.GetAll);

    server.patch("/users/:id", {preHandler: auth.user}, userController.update);

    server.delete("/users/:id", {preHandler: auth.user}, userController.delUser);
}

