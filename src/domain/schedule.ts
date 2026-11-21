import type { HabitSchedule } from '../generated/prisma/client';

// Regras puras de schedule: recebem as versões e os eventos já buscados e
// não tocam no banco. Ficam fora do checkinRepository pra poderem ser
// carregadas (e testadas) sem instanciar o PrismaClient (issue #22).

export type LogEvent = { date: Date; kind: 'CHECKIN' | 'UNDO'; checkedAt: Date };

function coversDay(version: HabitSchedule, day: Date): boolean {
    return (
        version.effectiveFrom.getTime() <= day.getTime() &&
        (version.effectiveTo === null || version.effectiveTo.getTime() >= day.getTime())
    );
}

// DAILY sempre é dia-alvo; WEEKLY olha o dia da semana; INTERVAL conta
// dias corridos desde que a versão passou a valer.
export function isTargetDay(version: HabitSchedule, day: Date): boolean {
    if (version.type === 'DAILY') return true;
    if (version.type === 'WEEKLY') return version.daysOfWeek.includes(day.getUTCDay());

    const elapsedDays = Math.round((day.getTime() - version.effectiveFrom.getTime()) / 86_400_000);
    return elapsedDays >= 0 && elapsedDays % (version.intervalDays ?? 1) === 0;
}

// versão que vale pra um dia D: dentre as que cobrem D, a que começou
// mais recentemente. Normalmente só uma versão cobre D; mais de uma
// significa que D teve mais de uma edição de schedule antes de fechar.
function lastVersionCovering(schedules: HabitSchedule[], day: Date): HabitSchedule | null {
    const covering = schedules.filter((v) => coversDay(v, day));
    if (covering.length === 0) return null;
    return covering.reduce((latest, v) => (v.effectiveFromAt > latest.effectiveFromAt ? v : latest));
}

// dentre as versões que cobriram D, a mais recente que ainda incluía D
// como dia-alvo — usada só quando a versão vigente ao fim de D não
// inclui mais D (selamento: tranca no estado de antes dela sair do alvo).
function lastTargetingVersion(schedules: HabitSchedule[], day: Date): HabitSchedule | null {
    const targeting = schedules.filter((v) => coversDay(v, day) && isTargetDay(v, day));
    if (targeting.length === 0) return null;
    return targeting.reduce((latest, v) => (v.effectiveFromAt > latest.effectiveFromAt ? v : latest));
}

function netCountOnDay(events: LogEvent[], day: Date, until?: Date): number {
    return events.reduce((count, e) => {
        if (e.date.getTime() !== day.getTime()) return count;
        if (until && e.checkedAt.getTime() > until.getTime()) return count;
        return count + (e.kind === 'CHECKIN' ? 1 : -1);
    }, 0);
}

// completed(D): a versão que vale ao fim de D define o alvo. Se D
// continua sendo dia-alvo por ela, reprojeta contra esse alvo (o dia
// inteiro); se D saiu do alvo, tranca no estado acumulado até o
// instante em que a última versão que ainda incluía D deixou de valer.
export function isCompleted(schedules: HabitSchedule[], events: LogEvent[], day: Date): boolean {
    const current = lastVersionCovering(schedules, day);
    if (!current) return false;

    if (isTargetDay(current, day)) {
        return netCountOnDay(events, day) >= current.targetPerDay;
    }

    const sealed = lastTargetingVersion(schedules, day);
    if (!sealed) return false;

    return netCountOnDay(events, day, sealed.effectiveToAt ?? undefined) >= sealed.targetPerDay;
}

// dias-alvo estritamente entre from e to (exclusive nas duas pontas) —
// usado pra saber se duas entradas da streak são contíguas (nenhum
// dia-alvo pulado no meio) e pra achar o dia exato de um gap de 1
// dia-alvo (grace period).
export function targetDaysBetween(schedules: HabitSchedule[], from: Date, to: Date): Date[] {
    const result: Date[] = [];
    let cursor = new Date(from.getTime() + 86_400_000);
    while (cursor.getTime() < to.getTime()) {
        const version = lastVersionCovering(schedules, cursor);
        if (version && isTargetDay(version, cursor)) result.push(cursor);
        cursor = new Date(cursor.getTime() + 86_400_000);
    }
    return result;
}
