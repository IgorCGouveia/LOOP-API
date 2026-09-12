import { FastifyReply, FastifyRequest } from "fastify";
import { Logar, signAccessToken } from "../services/indexService";
import { attemptTracker } from "../services/attemptTracker";
import { buildRateLimitError } from "../Middleware/rateLimit";
import * as refreshTokenService from "../services/refreshTokenServices";
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from "../config/cookies";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export default class Login{
    async login(req: FastifyRequest, res:FastifyReply){
        const {email,password} = req.body as {email: string, password: string}
        if(!email || !password){
            return res.status(400).send({ error: "Campos não preenchidos." });
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
            return res.status(401).send({ error: "Email ou senha incorretos." });
        }

        attemptTracker.recordSuccess(email);

        // refresh token só serve o loop-web (cookie httpOnly) — não existe
        // cliente mobile ainda usando isso; ver DECISIONS.md sobre o escopo
        // dessa decisão.
        const { rawToken, expiresAt } = await refreshTokenService.issueRefreshToken(token.id);
        res.setCookie(REFRESH_COOKIE_NAME, rawToken, { ...refreshCookieOptions(), expires: expiresAt });

        return res.status(200).send({ message: "Login realizado com sucesso.", data: token });
    }

    async refresh(req: FastifyRequest, res: FastifyReply){
        const rawToken = req.cookies[REFRESH_COOKIE_NAME];
        if(!rawToken){
            return res.status(401).send({ error: "Refresh token não informado." });
        }

        const entry = await refreshTokenService.validateRefreshToken(rawToken);
        if(!entry){
            return res.status(401).send({ error: "Refresh token inválido ou expirado." });
        }

        // sem rotação: o mesmo refresh token continua valendo, só emite um
        // accessToken novo — trade-off explícito, ver DECISIONS.md.
        const token = signAccessToken(entry.user);
        return res.status(200).send({ message: "Token renovado com sucesso.", data: token });
    }

    async logout(req: FastifyRequest, res: FastifyReply){
        const rawToken = req.cookies[REFRESH_COOKIE_NAME];
        if(rawToken){
            await refreshTokenService.revokeRefreshToken(rawToken);
        }

        res.clearCookie(REFRESH_COOKIE_NAME, { path: refreshCookieOptions().path });
        return res.status(200).send({ message: "Logout realizado com sucesso.", data: null });
    }
}
