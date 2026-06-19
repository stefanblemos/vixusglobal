-- AlterTable
ALTER TABLE "ReserveDeposit" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'RESERVE',
ADD COLUMN     "qboRef" TEXT;
