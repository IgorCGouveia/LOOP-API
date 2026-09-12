import { randomBytes, createHash } from "node:crypto";

// Refresh token: 32 bytes de entropia aleatória, não senha escolhida por
// humano — por isso hash rápido (sha256), não argon2. Argon2 existe pra
// compensar baixa entropia de senha (custo alto = ataque de força bruta
// caro); um token de 256 bits já é inviável de adivinhar, então o custo
// extra do argon2 não compra proteção nenhuma aqui, só lentidão em cada
// POST /refresh.
export function generateOpaqueToken(): string {
    return randomBytes(32).toString("hex");
}

export function hashToken(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
}
