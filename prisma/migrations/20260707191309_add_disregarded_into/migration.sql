-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "disregardedIntoId" TEXT;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_disregardedIntoId_fkey" FOREIGN KEY ("disregardedIntoId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
