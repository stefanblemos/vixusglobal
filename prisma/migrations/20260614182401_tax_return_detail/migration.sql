-- AlterTable
ALTER TABLE "TaxReturn" ADD COLUMN     "city" TEXT,
ADD COLUMN     "netIncome" DECIMAL(20,2),
ADD COLUMN     "ordinaryIncome" DECIMAL(20,2),
ADD COLUMN     "preparer" TEXT,
ADD COLUMN     "responsible" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "taxId" TEXT,
ADD COLUMN     "totalIncome" DECIMAL(20,2);
