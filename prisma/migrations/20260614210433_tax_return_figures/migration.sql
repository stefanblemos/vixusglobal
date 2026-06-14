-- AlterTable
ALTER TABLE "TaxReturn" ADD COLUMN     "address" TEXT,
ADD COLUMN     "businessActivity" TEXT,
ADD COLUMN     "figures" JSONB,
ADD COLUMN     "incorporationDate" TEXT;
