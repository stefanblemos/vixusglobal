-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];
