import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../app";
import * as checkinRepository from "../repositories/checkinRepository";

function day(iso: string): Date {
    return new Date(`${iso}T00:00:00.000Z`);
}

describe("Path A — HabitSchedule versionado + completed(D)", () => {
    let userId: string;
    let habitId: string;

    beforeAll(async () => {
        const user = await prisma.user.create({
            data: {
                name: "Usuário Path A",
                email: `path-a-${Date.now()}@example.com`,
                password: "hash-fake",
                timezone: "America/Sao_Paulo",
            },
        });
        userId = user.id;

        const habit = await prisma.habit.create({
            data: { name: "Hábito Path A", userId },
        });
        habitId = habit.id;
    });

    afterAll(async () => {
        await prisma.habit.delete({ where: { id: habitId } }).catch(() => {});
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
        await prisma.$disconnect();
    });

    it("createScheduleVersion fecha a versão vigente e abre uma nova", async () => {
        const v1 = await checkinRepository.createScheduleVersion(
            habitId,
            { type: "DAILY", targetPerDay: 1 },
            day("2026-03-01"),
        );
        const v2 = await checkinRepository.createScheduleVersion(
            habitId,
            { type: "WEEKLY", targetPerDay: 1, daysOfWeek: [1, 3, 5] },
            day("2026-03-10"),
        );

        const closed = await prisma.habitSchedule.findUnique({ where: { id: v1.id } });
        expect(closed?.effectiveTo).toEqual(day("2026-03-10"));

        const current = await checkinRepository.getCurrentSchedule(habitId);
        expect(current?.id).toBe(v2.id);
        expect(current?.effectiveTo).toBeNull();
    });

    it("targetPerDay > 1: dia parcial não conta pro streak", async () => {
        const scheduleHabit = await prisma.habit.create({ data: { name: "Parcial", userId } });
        await prisma.habitSchedule.create({
            data: {
                habitId: scheduleHabit.id,
                type: "DAILY",
                targetPerDay: 3,
                daysOfWeek: [],
                effectiveFrom: day("2026-03-01"),
                effectiveFromAt: new Date("2026-03-01T08:00:00.000Z"),
            },
        });

        await prisma.habitLog.createMany({
            data: [
                { habitId: scheduleHabit.id, date: day("2026-03-02"), checkedAt: new Date("2026-03-02T09:00:00Z"), kind: "CHECKIN" },
                { habitId: scheduleHabit.id, date: day("2026-03-02"), checkedAt: new Date("2026-03-02T10:00:00Z"), kind: "CHECKIN" },
            ],
        });

        const effectiveLog = await checkinRepository.getEffectiveLog(scheduleHabit.id);
        expect(effectiveLog).toEqual([]);

        await prisma.habit.delete({ where: { id: scheduleHabit.id } });
    });

    it("dia sai da agenda no meio do próprio dia: o que já foi completado antes fica selado", async () => {
        const sealHabit = await prisma.habit.create({ data: { name: "Selamento", userId } });

        // quarta-feira (2026-03-04): versão A pede WEEKLY [Seg,Qua,Sex],
        // completada às 9h; às 14h edita pra WEEKLY [Ter,Qui] (quarta sai
        // da agenda).
        const versionA = await prisma.habitSchedule.create({
            data: {
                habitId: sealHabit.id,
                type: "WEEKLY",
                targetPerDay: 1,
                daysOfWeek: [1, 3, 5],
                effectiveFrom: day("2026-03-01"),
                effectiveFromAt: new Date("2026-03-01T00:00:00.000Z"),
                effectiveTo: day("2026-03-04"),
                effectiveToAt: new Date("2026-03-04T14:00:00.000Z"),
            },
        });
        await prisma.habitSchedule.create({
            data: {
                habitId: sealHabit.id,
                type: "WEEKLY",
                targetPerDay: 1,
                daysOfWeek: [2, 4],
                effectiveFrom: day("2026-03-04"),
                effectiveFromAt: new Date("2026-03-04T14:00:00.000Z"),
            },
        });
        await prisma.habitLog.create({
            data: {
                habitId: sealHabit.id,
                date: day("2026-03-04"),
                checkedAt: new Date("2026-03-04T09:00:00.000Z"),
                kind: "CHECKIN",
            },
        });

        const effectiveLog = await checkinRepository.getEffectiveLog(sealHabit.id);
        expect(effectiveLog).toContainEqual(day("2026-03-04"));

        await prisma.habit.delete({ where: { id: sealHabit.id } });
        expect(versionA.id).toBeTruthy();
    });

    it("dia continua na agenda, só o alvo sobe no mesmo dia: reprojeta pra baixo", async () => {
        const reprojectHabit = await prisma.habit.create({ data: { name: "Reprojeção", userId } });

        await prisma.habitSchedule.create({
            data: {
                habitId: reprojectHabit.id,
                type: "WEEKLY",
                targetPerDay: 1,
                daysOfWeek: [1, 3, 5],
                effectiveFrom: day("2026-03-01"),
                effectiveFromAt: new Date("2026-03-01T00:00:00.000Z"),
                effectiveTo: day("2026-03-04"),
                effectiveToAt: new Date("2026-03-04T14:00:00.000Z"),
            },
        });
        await prisma.habitSchedule.create({
            data: {
                habitId: reprojectHabit.id,
                type: "DAILY",
                targetPerDay: 3,
                daysOfWeek: [],
                effectiveFrom: day("2026-03-04"),
                effectiveFromAt: new Date("2026-03-04T14:00:00.000Z"),
            },
        });
        await prisma.habitLog.create({
            data: {
                habitId: reprojectHabit.id,
                date: day("2026-03-04"),
                checkedAt: new Date("2026-03-04T09:00:00.000Z"),
                kind: "CHECKIN",
            },
        });

        const effectiveLog = await checkinRepository.getEffectiveLog(reprojectHabit.id);
        expect(effectiveLog).not.toContainEqual(day("2026-03-04"));

        await prisma.habit.delete({ where: { id: reprojectHabit.id } });
    });

    it("undo (evento compensatório) tira o dia da lista sem apagar o CHECKIN original", async () => {
        const undoHabit = await prisma.habit.create({ data: { name: "Undo", userId } });
        await prisma.habitSchedule.create({
            data: {
                habitId: undoHabit.id,
                type: "DAILY",
                targetPerDay: 1,
                daysOfWeek: [],
                effectiveFrom: day("2026-03-01"),
                effectiveFromAt: new Date("2026-03-01T00:00:00.000Z"),
            },
        });
        const checkin = await checkinRepository.insertLogEvent(undoHabit.id, day("2026-03-02"), "CHECKIN");

        expect(await checkinRepository.getEffectiveLog(undoHabit.id)).toContainEqual(day("2026-03-02"));

        await checkinRepository.insertLogEvent(undoHabit.id, day("2026-03-02"), "UNDO", checkin.id);

        expect(await checkinRepository.getEffectiveLog(undoHabit.id)).not.toContainEqual(day("2026-03-02"));

        const original = await prisma.habitLog.findUnique({ where: { id: checkin.id } });
        expect(original).not.toBeNull();

        const undoable = await checkinRepository.findUndoableCheckIn(undoHabit.id);
        expect(undoable).toBeNull();

        await prisma.habit.delete({ where: { id: undoHabit.id } });
    });
});
