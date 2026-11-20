// Auditoria só de leitura do estado que as escritas parciais de antes das
// issues #16, #19 e #21 podem ter deixado no banco. Não grava nada.
// Uso: npm run audit:integrity
// Roteiro: doc-2/guides/backfill-habit-schedule.md
import { prisma } from "../db";
import * as checkinRepository from "../repositories/checkinRepository";
import { RecomputeLongestStreak } from "../services/checkinServices";

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
    // #19: hábito sem nenhuma versão de schedule nunca pontua streak.
    // Correção: npm run backfill:schedules
    const withoutSchedule = await checkinRepository.findHabitIdsWithoutSchedule();
    console.log(`Hábitos sem HabitSchedule: ${withoutSchedule.length}`);
    for (const id of withoutSchedule) console.log(`  habit=${id}`);

    const habits = await prisma.habit.findMany({ select: { id: true, longestStreak: true } });
    let orphanFills = 0;
    let inflated = 0;

    for (const habit of habits) {
        // #16/#21: grace fill sem nenhum dia completo depois dele (check-in
        // desfeito ou que falhou depois do fill) perdoa um dia sem motivo.
        const fills = await checkinRepository.findGraceFills(habit.id);
        if (fills.length > 0) {
            const fillDays = new Set(fills.map((f) => f.date.getTime()));
            const completedDays = (await checkinRepository.getEffectiveLog(habit.id)).filter((d) => !fillDays.has(d.getTime()));
            for (const fill of fills) {
                if (!completedDays.some((d) => d.getTime() > fill.date.getTime())) {
                    orphanFills++;
                    console.log(`  grace fill órfão: habit=${habit.id} date=${iso(fill.date)} checkinId=${fill.checkinId ?? "null"}`);
                }
            }
        }

        // #16: longestStreak gravado acima do que o log efetivo sustenta.
        const recomputed = await RecomputeLongestStreak(habit.id);
        if (habit.longestStreak > recomputed) {
            inflated++;
            console.log(`  longestStreak inflado: habit=${habit.id} gravado=${habit.longestStreak} recalculado=${recomputed}`);
        }
    }

    console.log(`Grace fills órfãos: ${orphanFills}`);
    console.log(`Hábitos com longestStreak inflado: ${inflated}`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
