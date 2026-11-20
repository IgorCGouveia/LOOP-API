import 'dotenv/config'
import Fastify from "fastify"
import cookie from "@fastify/cookie";
import {userRoutes} from './routes/UserRoute';
import { habitRoutes } from './routes/HabitRoute';
import { checkinRoutes } from './routes/CheckinRoute';
import { LoginRoute } from './routes/indexRoute';
import { errorHandler } from './Middleware/errorHandler';
import { registerRateLimit } from './Middleware/rateLimit';
import { registerCors } from './Middleware/cors';

// o PrismaClient mora em ./db (issue #22): app.ts é só a raiz HTTP.

export function buildApp(){


    //inicia o fastify com logging
    // trustProxy: true — Render é hop único de proxy; sem isso o rate limit
    // de IP vira global
     const server = Fastify({logger: true, trustProxy: true});
    registerCors(server);
    server.register(cookie);
    registerRateLimit(server);
    server.register(userRoutes);
    server.register(habitRoutes);
    server.register(checkinRoutes);
    server.register(LoginRoute);
    server.setErrorHandler(errorHandler)
    return server;
}
