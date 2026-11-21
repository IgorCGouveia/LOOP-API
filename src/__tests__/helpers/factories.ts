import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { prisma } from "../../db";
import { signAccessToken } from "../../services/indexService";
import * as habitService from "../../services/habitServices";
import type { ScheduleInput } from "../../schema/habitVal";

// Fábricas de dados para os testes de integração. Gravam direto no banco
// em vez de passar por POST /users porque:
// - POST /users tem rate limit de 5 por hora por instância do app, e um
//   arquivo de teste que crie 6 usuários bateria no 429;
// - admin precisa existir de verdade. Token de admin assinado com um id
//   inventado esconde bugs de "usuário do token não existe" (ver
//   doc-2/investigations/2026-11-20-auditoria-de-testes.md).
//
// O token sai de signAccessToken, a mesma função do /login, então o
// formato é o mesmo que o cliente recebe.

export const DEFAULT_PASSWORD = "senha12345";

// argon2 é lento de propósito; um hash só por processo basta.
let passwordHash: Promise<string> | undefined;
function hashDefaultPassword() {
    passwordHash ??= argon2.hash(DEFAULT_PASSWORD, { type: argon2.argon2id });
    return passwordHash;
}

let sequence = 0;
export function uniqueEmail(prefix: string) {
    sequence += 1;
    return `${prefix}-${Date.now()}-${process.pid}-${sequence}@example.com`;
}

export type TestUser = {
    id: string;
    email: string;
    password: string;
    role: "USER" | "ADMIN";
    token: string;
};

export async function createUser(options: {
    prefix?: string;
    role?: "USER" | "ADMIN";
    timezone?: string;
    name?: string;
} = {}): Promise<TestUser> {
    const role = options.role ?? "USER";
    const email = uniqueEmail(options.prefix ?? role.toLowerCase());

    const user = await prisma.user.create({
        data: {
            name: options.name ?? "Usuário de Teste",
            email,
            password: await hashDefaultPassword(),
            timezone: options.timezone ?? "America/Sao_Paulo",
            role,
        },
    });

    const { accessToken } = signAccessToken(user);
    return { id: user.id, email, password: DEFAULT_PASSWORD, role, token: accessToken };
}

export function createAdmin(options: { prefix?: string } = {}) {
    return createUser({ ...options, role: "ADMIN" });
}

export async function createHabit(userId: string, options: { name?: string; schedule?: ScheduleInput } = {}) {
    return habitService.CreateHabit({
        name: options.name ?? "Hábito de teste",
        userId,
        schedule: options.schedule,
    });
}

export function bearer(token: string) {
    return { authorization: `Bearer ${token}` };
}

// Token assinado à mão, para casos de borda do middleware de auth.
export function signRaw(payload: object | string, options: jwt.SignOptions = {}, secret = process.env.SECRET_KEY as string) {
    return jwt.sign(payload, secret, options);
}

// Apaga usuários e tudo que depende deles (hábitos, logs e refresh tokens
// saem por cascade).
export async function deleteUsers(ids: Array<string | undefined>) {
    const existing = ids.filter((id): id is string => Boolean(id));
    if (existing.length === 0) return;
    await prisma.user.deleteMany({ where: { id: { in: existing } } });
}
