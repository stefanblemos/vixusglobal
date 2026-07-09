-- AlterEnum
ALTER TYPE "PoolEntryKind" ADD VALUE 'CAPITAL_CALL';

-- AlterTable
ALTER TABLE "PoolLoan" ADD COLUMN     "expectedClosingDate" DATE;

-- CreateTable
CREATE TABLE "HouseChangeOrder" (
    "id" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseChangeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolCapitalCall" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalAmount" DECIMAL(20,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoolCapitalCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolCapitalCallLine" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "contributionId" TEXT,

    CONSTRAINT "PoolCapitalCallLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HouseChangeOrder_houseId_idx" ON "HouseChangeOrder"("houseId");

-- CreateIndex
CREATE INDEX "PoolCapitalCall_poolId_idx" ON "PoolCapitalCall"("poolId");

-- CreateIndex
CREATE UNIQUE INDEX "PoolCapitalCallLine_contributionId_key" ON "PoolCapitalCallLine"("contributionId");

-- AddForeignKey
ALTER TABLE "HouseChangeOrder" ADD CONSTRAINT "HouseChangeOrder_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "PoolHouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolCapitalCall" ADD CONSTRAINT "PoolCapitalCall_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "InvestmentPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolCapitalCallLine" ADD CONSTRAINT "PoolCapitalCallLine_callId_fkey" FOREIGN KEY ("callId") REFERENCES "PoolCapitalCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolCapitalCallLine" ADD CONSTRAINT "PoolCapitalCallLine_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "PoolMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

