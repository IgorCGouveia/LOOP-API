// Corrige o effectiveFrom das versões criadas pelo backfill antigo, que
// usava o dia UTC do createdAt em vez do dia local do dono (issue #23).
// Por padrão só lista o que mudaria. Com --apply, grava.
// Uso: npm run fix:backfill-effective-from [-- --apply]
// Roteiro: doc-2/guides/backfill-habit-schedule.md
import { prisma } from "../db";
import { findMisdatedBackfilledSchedules, fixMisdatedBackfilledSchedules } from "./habitScheduleBackfill";

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
    const apply = process.argv.includes("--apply");
    const rows = await findMisdatedBackfilledSchedules();

    // uma linha por versão, com o valor antigo, pra dar pra desfazer à mão
    for (const row of rows) {
        console.log(
            `schedule=${row.scheduleId} habit=${row.habitId} tz=${row.timezone} ` +
                `effectiveFrom ${iso(row.oldEffectiveFrom)} -> ${iso(row.newEffectiveFrom)}`,
        );
    }
    console.log(`${rows.length} versão(ões) a corrigir.`);

    if (!apply) {
        console.log("Dry-run: nada foi gravado. Rode com --apply para gravar.");
        return;
    }
    await fixMisdatedBackfilledSchedules(rows);
    console.log("Correção aplicada.");
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
