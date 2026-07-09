-- CreateEnum
CREATE TYPE "BankRateType" AS ENUM ('FIXED', 'PRIME_SPREAD', 'SOFR_SPREAD');

-- CreateEnum
CREATE TYPE "BankInterestBasis" AS ENUM ('DRAWN', 'COMMITTED');

-- CreateEnum
CREATE TYPE "BankReleaseMode" AS ENUM ('SWEEP_FULL', 'SWEEP_PCT_LAST_FULL');

-- CreateEnum
CREATE TYPE "BankFeeTiming" AS ENUM ('CLOSING', 'PER_DRAW', 'PER_DRAW_BATCH', 'MONTHLY', 'PER_PAYOFF', 'FINAL');

-- CreateEnum
CREATE TYPE "BankFeeKind" AS ENUM ('FLAT', 'PCT_COMMITTED', 'PCT_PAYOFF');

-- AlterTable
ALTER TABLE "BankProfile" ADD COLUMN     "achFeePerBatch" DECIMAL(20,2) NOT NULL DEFAULT 0,
ADD COLUMN     "brokerPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "budgetReviewFee" DECIMAL(20,2) NOT NULL DEFAULT 0,
ADD COLUMN     "drawProcessingFee" DECIMAL(20,2) NOT NULL DEFAULT 0,
ADD COLUMN     "extensionFeePct" DECIMAL(5,2) NOT NULL DEFAULT 1,
ADD COLUMN     "extensionMonths" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "indexPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
ADD COLUMN     "interestBasis" "BankInterestBasis" NOT NULL DEFAULT 'DRAWN',
ADD COLUMN     "processingFee" DECIMAL(20,2) NOT NULL DEFAULT 0,
ADD COLUMN     "rateType" "BankRateType" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "reconveyanceFee" DECIMAL(20,2) NOT NULL DEFAULT 0,
ADD COLUMN     "releaseMode" "BankReleaseMode" NOT NULL DEFAULT 'SWEEP_FULL',
ADD COLUMN     "reserveMonths" DECIMAL(4,1) NOT NULL DEFAULT 6,
ADD COLUMN     "spreadPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
ADD COLUMN     "sweepPct" DECIMAL(5,2) NOT NULL DEFAULT 100,
ADD COLUMN     "termMonths" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "titleEscrowPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ALTER COLUMN "aprPct" SET DATA TYPE DECIMAL(6,3),
ALTER COLUMN "closingFeePct" SET DEFAULT 0,
ALTER COLUMN "appraisalFee" SET DEFAULT 0,
ALTER COLUMN "legalFee" SET DEFAULT 0,
ALTER COLUMN "inspectionFeePerDraw" SET DEFAULT 0,
ALTER COLUMN "servicingMonthly" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "BankCustomFee" (
    "id" TEXT NOT NULL,
    "bankProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timing" "BankFeeTiming" NOT NULL DEFAULT 'CLOSING',
    "kind" "BankFeeKind" NOT NULL DEFAULT 'FLAT',
    "amount" DECIMAL(20,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankCustomFee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankCustomFee_bankProfileId_idx" ON "BankCustomFee"("bankProfileId");

-- AddForeignKey
ALTER TABLE "BankCustomFee" ADD CONSTRAINT "BankCustomFee_bankProfileId_fkey" FOREIGN KEY ("bankProfileId") REFERENCES "BankProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

