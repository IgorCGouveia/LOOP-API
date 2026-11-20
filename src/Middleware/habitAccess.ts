import { FastifyReply, FastifyRequest } from "fastify";
import type { Habit } from "../generated/prisma/client";
import * as habitService from "../services/habitServices";

declare module "fastify" {
    interface FastifyRequest {
        // preenchido por requireHabitAccess: o hábito da rota, já carregado
        // e com o acesso conferido.
        habit: Habit;
    }
}

export type HabitAction = "habit:update" | "habit:delete" | "checkin:create" | "checkin:undo" | "checkin:list";

type Rule = { allowAdmin: boolean; forbidden: string };

// Política de acesso a um hábito, num lugar só (issue #17, ADR-0005).
// Espelha docs/API-REFERENCE.md: toda rota no nível do hábito é só do
// dono. Admin enxerga check-ins de qualquer um por
// GET /users/:userId/checkins, que não passa por aqui.
const POLICY: Record<HabitAction, Rule> = {
    "habit:update": { allowAdmin: false, forbidden: "Você não tem permissão para mudar os hábitos de outra pessoa." },
    "habit:delete": { allowAdmin: false, forbidden: "Você não tem permissão para mudar os hábitos de outra pessoa." },
    "checkin:create": { allowAdmin: false, forbidden: "Você não tem permissão para fazer check-in no hábito de outra pessoa." },
    "checkin:undo": { allowAdmin: false, forbidden: "Você não tem permissão para desfazer o check-in do hábito de outra pessoa." },
    "checkin:list": { allowAdmin: false, forbidden: "Você não tem permissão para ver os check-ins do hábito de outra pessoa." },
};

// preHandler que roda depois de auth.user: carrega o hábito de :habitId
// (ou :id) uma vez, aplica a regra da ação e deixa o hábito em
// req.habit pro controller.
export function requireHabitAccess(action: HabitAction) {
    const rule = POLICY[action];

    return async (req: FastifyRequest, res: FastifyReply) => {
        const params = req.params as { habitId?: string; id?: string };
        const habitId = params.habitId ?? params.id ?? "";

        const habit = await habitService.FindHabit(habitId);
        if (habit == null) {
            return res.status(404).send({ error: "Hábito não encontrado." });
        }

        const isOwner = req.user.id === habit.userId;
        const isAllowedAdmin = rule.allowAdmin && req.user.role === "ADMIN";
        if (!isOwner && !isAllowedAdmin) {
            return res.status(403).send({ error: rule.forbidden });
        }

        req.habit = habit;
    };
}
