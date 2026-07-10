-- DropIndex
DROP INDEX "PoolLoan_poolId_key";

-- AlterTable
ALTER TABLE "PoolHouse" ADD COLUMN     "loanId" TEXT;

-- CreateIndex
CREATE INDEX "PoolHouse_loanId_idx" ON "PoolHouse"("loanId");

-- CreateIndex
CREATE INDEX "PoolLoan_poolId_idx" ON "PoolLoan"("poolId");

-- AddForeignKey
ALTER TABLE "PoolHouse" ADD CONSTRAINT "PoolHouse_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "PoolLoan"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: casas de pools que já tinham UM loan passam a apontar para ele
UPDATE "PoolHouse" h
SET "loanId" = l.id
FROM "PoolLoan" l
WHERE l."poolId" = h."poolId" AND h."loanId" IS NULL;
