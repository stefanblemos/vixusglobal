-- AlterEnum
ALTER TYPE "BuilderCompMode" ADD VALUE 'OPEN_BOOK';

-- AlterTable
ALTER TABLE "CatalogModelLocation" ADD COLUMN     "costOpenBook" DECIMAL(20,2);

-- AlterTable
ALTER TABLE "PoolSimulation" ADD COLUMN     "flatFeePerHouse" DECIMAL(20,2) NOT NULL DEFAULT 0;

