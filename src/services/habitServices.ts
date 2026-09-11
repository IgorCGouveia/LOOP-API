import {prisma } from '../app';
import {CreateHabitInput, UpdateHabitInput} from  '../schema/habitVal'
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

async function ensureHabitExists(id: string){
    const exist = await prisma.habit.findUnique({where: {id}})
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

    const habit = await prisma.habit.create({
        data: {
            name: data.name,
            description: data.description,
            userId: data.userId
        },
    });

    // effectiveFrom da 1ª versão começa hoje, não amanhã — a regra
    // forward-only é sobre edição; criação não tem histórico a proteger.
    const today = getDateOnlyInTimezone(new Date(), user?.timezone ?? 'UTC');
    const schedule = await checkinRepository.createScheduleVersion(habit.id, data.schedule ?? DEFAULT_SCHEDULE, today);

    return { ...habit, schedule };
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

export async function UpdateHabit(id: string,data: UpdateHabitInput){

    const habit = await ensureHabitExists(id);
    const { schedule, ...rest } = data;

    let updated = habit;
    if (Object.keys(rest).length > 0) {
        updated = await prisma.habit.update({ where: { id }, data: rest });
    }

    if (schedule && updated) {
        const owner = await prisma.user.findUnique({ where: { id: updated.userId } });
        const today = getDateOnlyInTimezone(new Date(), owner?.timezone ?? 'UTC');
        await checkinRepository.createScheduleVersion(id, schedule, today);
    }

    const currentSchedule = await checkinRepository.getCurrentSchedule(id);
    return { ...updated, schedule: currentSchedule };

}


export async function DeleteHabit(id: string){

    await ensureHabitExists(id);

    const deleted = await prisma.habit.delete({where: {id}})

    return deleted;
}
