import { prisma } from "../app";
import { generateOpaqueToken, hashToken } from "../utils/token";

// 7 dias — padrão de mercado pra refresh token, sem exigência de produto
// que force outro valor. Decisão explicitamente delegada (spec 5.2).
const REFRESH_TOKEN_TTL_DAYS = 7;

// Cria um novo refresh token pro usuário, persiste só o hash (nunca o
// valor em texto puro — mesmo princípio de senha) e devolve o valor bruto,
// que só existe nesse retorno: quem chama grava no cookie e descarta.
export async function issueRefreshToken(userId: string): Promise<{ rawToken: string; expiresAt: Date }> {
    const rawToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
        data: { userId, tokenHash: hashToken(rawToken), expiresAt },
    });

    return { rawToken, expiresAt };
}

// Valida um refresh token recebido (cookie). Devolve o usuário dono se o
// token existe, não expirou e não foi revogado — null em qualquer outro
// caso (mesmo padrão do resto do projeto: "não encontrei/inválido" é
// valor de retorno, não exceção).
export async function validateRefreshToken(rawToken: string) {
    const entry = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashToken(rawToken) },
        include: { user: true },
    });

    if (!entry) return null;
    if (entry.revokedAt !== null) return null;
    if (entry.expiresAt.getTime() <= Date.now()) return null;

    return entry;
}

// Revoga um refresh token (logout). Idempotente: token já revogado ou
// inexistente não é erro — o efeito desejado ("esse cookie não serve mais
// pra nada") já vale.
export async function revokeRefreshToken(rawToken: string): Promise<void> {
    await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(rawToken), revokedAt: null },
        data: { revokedAt: new Date() },
    });
}
