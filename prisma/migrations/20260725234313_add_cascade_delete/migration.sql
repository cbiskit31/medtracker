-- DropForeignKey
ALTER TABLE "DoseLog" DROP CONSTRAINT "DoseLog_medicationId_fkey";

-- AddForeignKey
ALTER TABLE "DoseLog" ADD CONSTRAINT "DoseLog_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
