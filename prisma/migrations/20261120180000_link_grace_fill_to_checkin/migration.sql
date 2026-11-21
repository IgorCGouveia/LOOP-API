-- AlterTable
ALTER TABLE "GraceFill" ADD COLUMN     "checkinId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "GraceFill_checkinId_key" ON "GraceFill"("checkinId");

-- AddForeignKey
ALTER TABLE "GraceFill" ADD CONSTRAINT "GraceFill_checkinId_fkey" FOREIGN KEY ("checkinId") REFERENCES "HabitLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

