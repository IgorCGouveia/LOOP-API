import 'dotenv/config'
import Fastify from "fastify"
import {userRoutes} from './routes/UserRoute';
import { PrismaClient } from './generated/prisma/client';
import { habitRoutes } from './routes/HabitRoute';
import { checkinRoutes } from './routes/CheckinRoute';
import { LoginRoute } from './routes/indexRoute';
import { errorHandler } from './Middleware/errorHandler';
import { registerRateLimit } from './Middleware/rateLimit';

//instância global do Prisma Client(instância unica)
//pooling
//vai ser usado na camada de services para comunicar com o banco
export const prisma = new PrismaClient();



export function buildApp(){


    //inicia o fastify com logging
    // trustProxy: true — Render é hop único de proxy; sem isso o rate limit
    // de IP vira global
     const server = Fastify({logger: true, trustProxy: true});
    registerRateLimit(server);
    server.register(userRoutes);
    server.register(habitRoutes);
    server.register(checkinRoutes);
    server.register(LoginRoute);
    server.setErrorHandler(errorHandler)
    return server;
}
