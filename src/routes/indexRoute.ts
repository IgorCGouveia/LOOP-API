import { FastifyInstance } from "fastify";
import Login from "../controllers/indexController";

const LoginControl = new Login();

export async function LoginRoute(server: FastifyInstance){



    // rate limit por IP — só filtro de bot burro; a defesa real é o delay
    // progressivo por conta dentro do handler
    server.post("/login", {
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    }, LoginControl.login);

    // sem preHandler de auth — os dois dependem só do cookie de refresh,
    // não de um accessToken válido (o ponto de /refresh é justamente
    // renovar depois que o accessToken já expirou).
    server.post("/refresh", LoginControl.refresh);

    server.post("/logout", LoginControl.logout);
}