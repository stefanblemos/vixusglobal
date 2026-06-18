-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "collectsSalesTax" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hasEmployees" BOOLEAN NOT NULL DEFAULT false;
