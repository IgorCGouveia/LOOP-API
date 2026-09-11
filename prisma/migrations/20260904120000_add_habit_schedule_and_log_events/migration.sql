-- CreateEnum
CREATE TYPE "ScheduleType" AS ENUM ('DAILY', 'WEEKLY', 'INTERVAL');

-- CreateEnum
CREATE TYPE "LogKind" AS ENUM ('CHECKIN', 'UNDO');

-- AlterTable
ALTER TABLE "HabitLog" ADD COLUMN     "kind" "LogKind" NOT NULL DEFAULT 'CHECKIN',
ADD COLUMN     "undoesId" TEXT;

-- CreateTable
CREATE TABLE "HabitSchedule" (
    "id" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveFromAt" TIMESTAMP(3) NOT NULL,
    "effectiveTo" DATE,
    "effectiveToAt" TIMESTAMP(3),
    "targetPerDay" INTEGER NOT NULL,
    "type" "ScheduleType" NOT NULL,
    "daysOfWeek" INTEGER[],
    "intervalDays" INTEGER,

    CONSTRAINT "HabitSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HabitSchedule_habitId_effectiveFrom_idx" ON "HabitSchedule"("habitId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "HabitSchedule_habitId_effectiveFromAt_key" ON "HabitSchedule"("habitId", "effectiveFromAt");

-- CreateIndex
CREATE UNIQUE INDEX "HabitLog_undoesId_key" ON "HabitLog"("undoesId");

-- AddForeignKey
ALTER TABLE "HabitSchedule" ADD CONSTRAINT "HabitSchedule_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitLog" ADD CONSTRAINT "HabitLog_undoesId_fkey" FOREIGN KEY ("undoesId") REFERENCES "HabitLog"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CheckConstraint: WEEKLY exige pelo menos um dia em daysOfWeek
ALTER TABLE "HabitSchedule" ADD CONSTRAINT "weekly_requires_days" CHECK ("type" <> 'WEEKLY' OR array_length("daysOfWeek", 1) > 0);

-- CheckConstraint: INTERVAL exige intervalDays
ALTER TABLE "HabitSchedule" ADD CONSTRAINT "interval_requires_days" CHECK ("type" <> 'INTERVAL' OR "intervalDays" IS NOT NULL);
