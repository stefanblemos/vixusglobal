-- CreateTable
CREATE TABLE "PoolExpense" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROVISIONED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoolExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PoolExpense_poolId_idx" ON "PoolExpense"("poolId");

-- AddForeignKey
ALTER TABLE "PoolExpense" ADD CONSTRAINT "PoolExpense_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "InvestmentPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

