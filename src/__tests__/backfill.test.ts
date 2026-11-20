import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../db";
import * as checkinRepository from "../repositories/checkinRepository";
import {
    backfillHabitSchedules,
    findMisdatedBackfilledSchedules,
    fixMisdatedBackfilledSchedules,
} from "../scripts/habitScheduleBackfill";

// issue #23: o backfill de hábitos legados data a 1ª versão no dia local
// do dono, não no dia UTC do createdAt.
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// 2026-08-01T01:30Z é 2026-07-31 22:30 em São Paulo
const CREATED_AT = new Date("2026-08-01T01:30:00.000Z");

describe("backfill de HabitSchedule pra hábitos legados", () => {
    let userId: string;

    async function legacyHabit(name: string) {
        const habit = await prisma.habit.create({ data: { name, userId, createdAt: CREATED_AT } });
        await prisma.habitLog.create({ data: { habitId: habit.id, date: day("2026-07-31"), kind: "CHECKIN" } });
        return habit.id;
    }

    beforeAll(async () => {
        const user = await prisma.user.create({
            data: { name: "Usuário Legado", email: `legacy-${Date.now()}@example.com`, password: "hash-fake", timezone: "America/Sao_Paulo" },
        });
        userId = user.id;
    });

    afterAll(async () => {
        await prisma.habit.deleteMany({ where: { userId } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
        await prisma.$disconnect();
    });

    it("usa o dia local do dono: o check-in da noite do cadastro conta", async () => {
        const habitId = await legacyHabit("Criado à noite");

        expect(await backfillHabitSchedules({ userId })).toBe(1);

        const [version] = await checkinRepository.getScheduleVersions(habitId);
        expect(version.effectiveFrom).toEqual(day("2026-07-31"));
        expect(version.effectiveFromAt).toEqual(CREATED_AT);
        expect(await checkinRepository.getEffectiveLog(habitId)).toContainEqual(day("2026-07-31"));
    });

    it("é idempotente: hábito que já tem schedule fica como está", async () => {
        expect(await backfillHabitSchedules({ userId })).toBe(0);
    });

    it("correção: acha a linha datada em UTC pelo backfill antigo, aplica e não acha de novo", async () => {
        const habitId = await legacyHabit("Backfill antigo");
        // o que o backfill antigo gravava: dia UTC do createdAt
        await checkinRepository.insertBackfilledScheduleVersion(habitId, { type: "DAILY", targetPerDay: 1 }, day("2026-08-01"), CREATED_AT);
        expect(await checkinRepository.getEffectiveLog(habitId)).not.toContainEqual(day("2026-07-31"));

        const rows = await findMisdatedBackfilledSchedules({ userId });
        expect(rows).toEqual([
            expect.objectContaining({ habitId, oldEffectiveFrom: day("2026-08-01"), newEffectiveFrom: day("2026-07-31") }),
        ]);

        await fixMisdatedBackfilledSchedules(rows);

        expect(await checkinRepository.getEffectiveLog(habitId)).toContainEqual(day("2026-07-31"));
        expect(await findMisdatedBackfilledSchedules({ userId })).toEqual([]);
    });

    it("correção ignora versões criadas pela API (effectiveFromAt diferente do createdAt)", async () => {
        const habit = await prisma.habit.create({ data: { name: "Criado pela API", userId, createdAt: CREATED_AT } });
        await checkinRepository.createScheduleVersion(habit.id, { type: "DAILY", targetPerDay: 1 }, day("2026-08-01"));

        const rows = await findMisdatedBackfilledSchedules({ userId });
        expect(rows.map((r) => r.habitId)).not.toContain(habit.id);
    });
});
