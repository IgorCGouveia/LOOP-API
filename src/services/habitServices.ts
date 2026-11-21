import {prisma } from '../db';
import {CreateHabitInput, UpdateHabitInput} from  '../schema/habitVal'
import type { Habit } from '../generated/prisma/client';
import * as checkinRepository from '../repositories/checkinRepository';
import { getDateOnlyInTimezone } from '../utils/date';

const DEFAULT_SCHEDULE = { type: 'DAILY' as const, targetPerDay: 1 };

async function ensureUserExists(userId: string)
{
    const exist = await prisma.user.findUnique({where: {id: userId}});
    if(!exist){
        return null
    }
    return exist;
}

async function attachSchedules<T extends { id: string }>(habits: T[]) {
    const schedules = await checkinRepository.getCurrentSchedules(habits.map((h) => h.id));
    return habits.map((h) => ({ ...h, schedule: schedules.get(h.id) ?? null }));
}

export async function FindHabit(id: string) {

    const exist = await prisma.habit.findUnique({where: {id}})

    if(!exist){
        return null;
    }
    return exist;

}

export async function CreateHabit(data: CreateHabitInput)
{
    const user = await ensureUserExists(data.userId);

    // effectiveFrom da 1ª versão começa hoje, não amanhã — a regra
    // forward-only é sobre edição; criação não tem histórico a proteger.
    const today = getDateOnlyInTimezone(new Date(), user?.timezone ?? 'UTC');

    // hábito e 1ª versão do schedule no mesmo commit (issue #19): hábito
    // sem schedule nunca pontua streak e todayProgress fica null.
    return prisma.$transaction(async (tx) => {
        const habit = await tx.habit.create({
            data: {
                name: data.name,
                description: data.description,
                userId: data.userId
            },
        });

        const schedule = await checkinRepository.createScheduleVersion(
            habit.id,
            data.schedule ?? DEFAULT_SCHEDULE,
            today,
            tx,
        );

        return { ...habit, schedule };
    });
}

export async function GetAllHabitsFromUser(userId: string){

    const user = await ensureUserExists(userId);
    if(!user){
        return null
    }

    const habits = await prisma.habit.findMany({
        where: {userId: userId},
        orderBy: {name: 'asc'},

    });

    return attachSchedules(habits);
}

export async function GetAllHabits(){

    const habits = await prisma.habit.findMany({
        orderBy:{ name: 'asc'}
    });

    return attachSchedules(habits);
}

// recebe o hábito já carregado pelo requireHabitAccess, sem buscar de novo.
export async function UpdateHabit(habit: Habit, data: UpdateHabitInput){

    const { id } = habit;
    const { schedule, ...rest } = data;

    const owner = schedule ? await prisma.user.findUnique({ where: { id: habit.userId } }) : null;
    const today = getDateOnlyInTimezone(new Date(), owner?.timezone ?? 'UTC');

    // nome/descrição e a nova versão do schedule entram juntos ou nenhum
    // entra (issue #19).
    return prisma.$transaction(async (tx) => {
        let updated = habit;
        if (Object.keys(rest).length > 0) {
            updated = await tx.habit.update({ where: { id }, data: rest });
        }

        if (schedule) {
            await checkinRepository.createScheduleVersion(id, schedule, today, tx);
        }

        const currentSchedule = await checkinRepository.getCurrentSchedule(id, tx);
        return { ...updated, schedule: currentSchedule };
    });

}


export async function DeleteHabit(id: string){

    const deleted = await prisma.habit.delete({where: {id}})

    return deleted;
}
