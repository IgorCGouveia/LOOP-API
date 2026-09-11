import { FastifyInstance } from "fastify";
import Login from "../controllers/indexController";

const LoginControl = new Login();

export async function LoginRoute(server: FastifyInstance){



    // rate limit por IP — só filtro de bot burro; a defesa real é o delay
    // progressivo por conta dentro do handler
    server.post("/login", {
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    }, LoginControl.login);


    
}