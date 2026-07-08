-- CreateEnum
CREATE TYPE "PoolStatus" AS ENUM ('FUNDING', 'ACTIVE', 'CLOSING', 'CLOSED');

-- CreateEnum
CREATE TYPE "PoolHouseStatus" AS ENUM ('PLANNED', 'LOT_PURCHASED', 'UNDER_CONSTRUCTION', 'FOR_SALE', 'UNDER_CONTRACT', 'SOLD');

-- CreateEnum
CREATE TYPE "PoolMemberRole" AS ENUM ('MANAGER', 'INVESTOR');

-- CreateEnum
CREATE TYPE "PoolEntryKind" AS ENUM ('CONTRIBUTION', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "PoolDistributionKind" AS ENUM ('RETURN_OF_CAPITAL', 'PROFIT');

-- CreateTable
CREATE TABLE "InvestmentPool" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alias" TEXT,
    "companyId" TEXT,
    "noteLoanId" TEXT,
    "status" "PoolStatus" NOT NULL DEFAULT 'FUNDING',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "unitPrice" DECIMAL(20,4) NOT NULL DEFAULT 1000,
    "targetAmount" DECIMAL(20,2),
    "profitSharePct" DECIMAL(9,6),
    "profitShareTiming" TEXT,
    "fundingDeadline" DATE,
    "startDate" DATE,
    "plannedEndDate" DATE,
    "effectiveEndDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestmentPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolHouse" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" "PoolHouseStatus" NOT NULL DEFAULT 'PLANNED',
    "plannedLotCost" DECIMAL(20,2),
    "plannedBuildCost" DECIMAL(20,2),
    "plannedSalePrice" DECIMAL(20,2),
    "plannedClosingCost" DECIMAL(20,2),
    "bankName" TEXT,
    "bankLoanAmount" DECIMAL(20,2),
    "bankOriginationFee" DECIMAL(20,2),
    "bankInterestReserve" DECIMAL(20,2),
    "bankCashToClose" DECIMAL(20,2),
    "bankBudgetReviewFee" DECIMAL(20,2),
    "bankCharges" DECIMAL(20,2),
    "actualLotCost" DECIMAL(20,2),
    "actualBuildCost" DECIMAL(20,2),
    "ownCapital" DECIMAL(20,2),
    "soldPrice" DECIMAL(20,2),
    "payoffAmount" DECIMAL(20,2),
    "closingCost" DECIMAL(20,2),
    "contractDate" DATE,
    "saleDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoolHouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolMember" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "partyId" TEXT,
    "companyId" TEXT,
    "role" "PoolMemberRole" NOT NULL DEFAULT 'INVESTOR',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoolMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolContribution" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" "PoolEntryKind" NOT NULL DEFAULT 'CONTRIBUTION',
    "date" DATE NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "units" DECIMAL(20,4) NOT NULL,
    "transferGroupId" TEXT,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoolContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolDistribution" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "kind" "PoolDistributionKind" NOT NULL,
    "date" DATE NOT NULL,
    "totalAmount" DECIMAL(20,2) NOT NULL,
    "houseId" TEXT,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoolDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolDistributionLine" (
    "id" TEXT NOT NULL,
    "distributionId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,

    CONSTRAINT "PoolDistributionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolDocument" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "memberId" TEXT,
    "docType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "pdf" BYTEA,
    "pdfSize" INTEGER,
    "signedAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoolDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentPool_code_key" ON "InvestmentPool"("code");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentPool_companyId_key" ON "InvestmentPool"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentPool_noteLoanId_key" ON "InvestmentPool"("noteLoanId");

-- CreateIndex
CREATE INDEX "PoolHouse_poolId_idx" ON "PoolHouse"("poolId");

-- CreateIndex
CREATE INDEX "PoolMember_poolId_idx" ON "PoolMember"("poolId");

-- CreateIndex
CREATE INDEX "PoolContribution_memberId_idx" ON "PoolContribution"("memberId");

-- CreateIndex
CREATE INDEX "PoolDistribution_poolId_idx" ON "PoolDistribution"("poolId");

-- CreateIndex
CREATE INDEX "PoolDocument_poolId_idx" ON "PoolDocument"("poolId");

-- AddForeignKey
ALTER TABLE "InvestmentPool" ADD CONSTRAINT "InvestmentPool_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentPool" ADD CONSTRAINT "InvestmentPool_noteLoanId_fkey" FOREIGN KEY ("noteLoanId") REFERENCES "IntercompanyLoan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolHouse" ADD CONSTRAINT "PoolHouse_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "InvestmentPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolMember" ADD CONSTRAINT "PoolMember_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "InvestmentPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolMember" ADD CONSTRAINT "PoolMember_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolMember" ADD CONSTRAINT "PoolMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolContribution" ADD CONSTRAINT "PoolContribution_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "PoolMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolDistribution" ADD CONSTRAINT "PoolDistribution_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "InvestmentPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolDistribution" ADD CONSTRAINT "PoolDistribution_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "PoolHouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolDistributionLine" ADD CONSTRAINT "PoolDistributionLine_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "PoolDistribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolDistributionLine" ADD CONSTRAINT "PoolDistributionLine_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "PoolMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolDocument" ADD CONSTRAINT "PoolDocument_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "InvestmentPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
