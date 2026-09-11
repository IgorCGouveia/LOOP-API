import { FastifyReply, FastifyRequest } from "fastify";
import { Logar} from "../services/indexService";
import { attemptTracker } from "../services/attemptTracker";
import { buildRateLimitError } from "../Middleware/rateLimit";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export default class Login{
    async login(req: FastifyRequest, res:FastifyReply){
        const {email,password} = req.body as {email: string, password: string}
        if(!email || !password){
            return res.status(400).send("Campos não preenchidos.");
        }

        // delay progressivo por email, simétrico entre sucesso e falha
        // (pular no sucesso vira oráculo de timing)
        const delay = attemptTracker.getDelay(email);
        if (delay > 0) {
            // cap de concorrência: evita segurar N sockets em cascata
            if (!attemptTracker.acquireSlot(email)) {
                res.header("retry-after", "5");
                return res.status(429).send(buildRateLimitError(req));
            }
            try {
                await sleep(delay);
            } finally {
                attemptTracker.releaseSlot(email);
            }
        }

        const token = await Logar(email, password);

        if(token === null){
            attemptTracker.recordFailure(email);
            return res.status(401).send("Email ou senha incorretos.");
        }

        attemptTracker.recordSuccess(email);
        return res.status(200).send(token);
    }
}
