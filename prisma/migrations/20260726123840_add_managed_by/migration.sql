-- AlterTable
ALTER TABLE "User" ADD COLUMN     "managedByUserId" INTEGER;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managedByUserId_fkey" FOREIGN KEY ("managedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
