import 'dotenv/config';
import { PrismaClient } from './generated/prisma/client';

// instância global do Prisma Client (instância única, com pool de conexões).
// Mora fora do app.ts pra camada de dados não depender da raiz HTTP:
// importar um service ou o repositório não carrega rotas, controllers nem
// o setInterval do attemptTracker (issue #22).
export const prisma = new PrismaClient();
