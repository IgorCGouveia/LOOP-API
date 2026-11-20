# Glossário

| Termo | Significado | Onde vive no código |
|---|---|---|
| **Timezone do usuário** | Identificador IANA (ex.: `America/Sao_Paulo`) informado no cadastro. Define o que é "hoje" para aquele usuário. | `User.timezone` |
| **Dia local** | Data de calendário (sem hora) de um instante, vista no timezone do usuário. Fica salva como meia-noite UTC daquela data. | `getDateOnlyInTimezone` em `src/utils/date.ts` |
| **Instante** | Momento exato em UTC, com hora. | `HabitLog.checkedAt`, `HabitSchedule.effectiveFromAt` |
| **Evento de log** | Linha em `HabitLog`. Pode ser `CHECKIN` ou `UNDO`. Nada é apagado: desfazer grava um `UNDO` que aponta para o `CHECKIN`. | `HabitLog` |
| **Agenda (schedule)** | Frequência e meta do hábito: `DAILY`, `WEEKLY` ou `INTERVAL`, mais `targetPerDay`. É versionada. | `HabitSchedule` |
| **Versão de agenda** | Período em que uma agenda valeu, de `effectiveFrom` até `effectiveTo`. Editar fecha a versão atual e abre outra. | `createScheduleVersion` |
| **Dia-alvo** | Dia em que a agenda vigente pede check-in. Em `DAILY` todo dia é dia-alvo. | `isTargetDay` |
| **Dia completo** | Dia-alvo em que o saldo de check-ins (CHECKIN − UNDO) chegou à meta. | `isCompleted` |
| **Gap** | Dias-alvo sem check-in entre dois dias completos. | `targetDaysBetween` |
| **Grace token** | "Streak freeze". Saldo de 0 a 3 por hábito, +1 por mês. Perdoa um gap de exatamente 1 dia-alvo. | `Habit.graceTokens` |
| **Grace fill** | Registro do dia perdoado por um token. Conta como dia completo no cálculo de streak. | `GraceFill` |
| **Streak atual** | Quantidade de dias completos seguidos, contando para trás a partir do mais recente. | `computeTailStreak` |
| **Dia fechado** | Dia local que já passou para o usuário. O veredito dele (completo ou não) não deveria mudar. | invariante, ver [domain-model.md](./architecture/domain-model.md) |
