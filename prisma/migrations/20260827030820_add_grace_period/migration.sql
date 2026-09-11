-- AlterTable
ALTER TABLE "Habit" ADD COLUMN     "graceTokens" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "graceTokensUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "GraceFill" (
    "id" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "date" DATE NOT NULL,

    CONSTRAINT "GraceFill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GraceFill_habitId_date_key" ON "GraceFill"("habitId", "date");

-- AddForeignKey
ALTER TABLE "GraceFill" ADD CONSTRAINT "GraceFill_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
