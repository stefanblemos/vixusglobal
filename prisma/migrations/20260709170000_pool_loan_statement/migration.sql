-- CreateEnum
CREATE TYPE "PoolLoanEntryType" AS ENUM ('CLOSING_FEE', 'RESERVE', 'DRAW', 'DRAW_FEE', 'INTEREST', 'INTEREST_PAYMENT', 'PAYOFF', 'RECONVEYANCE', 'CREDIT', 'OTHER');

-- AlterTable
ALTER TABLE "PoolHouse" ADD COLUMN     "netReceived" DECIMAL(20,2);

-- CreateTable
CREATE TABLE "PoolLoan" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "bankProfileId" TEXT,
    "loanNumber" TEXT,
    "committed" DECIMAL(20,2),
    "aprPct" DECIMAL(6,3),
    "closingDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoolLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolLoanEntry" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "houseId" TEXT,
    "type" "PoolLoanEntryType" NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "memo" TEXT,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoolLoanEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PoolLoan_poolId_key" ON "PoolLoan"("poolId");

-- CreateIndex
CREATE INDEX "PoolLoanEntry_loanId_date_idx" ON "PoolLoanEntry"("loanId", "date");

-- AddForeignKey
ALTER TABLE "PoolLoan" ADD CONSTRAINT "PoolLoan_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "InvestmentPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolLoan" ADD CONSTRAINT "PoolLoan_bankProfileId_fkey" FOREIGN KEY ("bankProfileId") REFERENCES "BankProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolLoanEntry" ADD CONSTRAINT "PoolLoanEntry_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "PoolLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolLoanEntry" ADD CONSTRAINT "PoolLoanEntry_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "PoolHouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

