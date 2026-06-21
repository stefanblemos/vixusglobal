-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];
