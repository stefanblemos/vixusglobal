-- DDL de REFERENCIA das tabelas de catalogo (PostgreSQL) - gerado do schema Prisma da Vixus
-- Locations/modelos a 4U ja tem; use isto para mapear campos. Premissas: data/premissas.json

-- CreateEnum
CREATE TYPE "HouseType" AS ENUM ('AFFORDABLE', 'MID_RANGE', 'UPPER_MIDDLE', 'HIGH_END', 'LUXURY', 'DUPLEX', 'TRIPLEX', 'MULTIFAMILY');

-- CreateEnum
CREATE TYPE "OverfundingMode" AS ENUM ('NONE', 'REFUND_AT_CLOSING', 'REFUND_IN_DRAWS');

-- CreateEnum
CREATE TYPE "VehicleCostTiming" AS ENUM ('FORMATION', 'DISSOLUTION', 'ANNUAL', 'MONTHLY');

-- CreateEnum
CREATE TYPE "BankFeeTiming" AS ENUM ('CLOSING', 'PER_DRAW', 'PER_DRAW_BATCH', 'MONTHLY', 'PER_PAYOFF', 'FINAL');

-- CreateEnum
CREATE TYPE "BankFeeKind" AS ENUM ('FLAT', 'PCT_COMMITTED', 'PCT_PAYOFF');

-- CreateTable
CREATE TABLE "CatalogLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permitDays" INTEGER NOT NULL,
    "lotLeadDays" INTEGER NOT NULL,
    "saleDays" INTEGER NOT NULL,
    "lotCostEstimate" DECIMAL(20,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogWaterfallTier" (
    "id" TEXT NOT NULL,
    "hurdlePct" DECIMAL(6,2),
    "promotePct" DECIMAL(6,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogWaterfallTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogVehicleCost" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "timing" "VehicleCostTiming" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogVehicleCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogModel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "houseType" "HouseType" NOT NULL,
    "buildMonths" DECIMAL(4,1) NOT NULL,
    "sqft" INTEGER,
    "contractorFee" DECIMAL(20,2),
    "notes" TEXT,
    "photo" TEXT,
    "photoWidth" INTEGER,
    "photoHeight" INTEGER,
    "beds" INTEGER,
    "baths" DECIMAL(3,1),
    "garageSpaces" INTEGER,
    "builtSqft" INTEGER,
    "tagline" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogModelLocation" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "salePrice" DECIMAL(20,2) NOT NULL,
    "costPerformance" DECIMAL(20,2),
    "costContractor" DECIMAL(20,2),
    "costOpenBook" DECIMAL(20,2),

    CONSTRAINT "CatalogModelLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseTypeFee" (
    "type" "HouseType" NOT NULL,
    "fee" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HouseTypeFee_pkey" PRIMARY KEY ("type")
);

-- CreateTable
CREATE TABLE "BankProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ltcBuildPct" DECIMAL(5,2) NOT NULL DEFAULT 80,
    "ltcLandPct" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "financeLand" BOOLEAN NOT NULL DEFAULT false,
    "ltvPct" DECIMAL(5,2) NOT NULL DEFAULT 70,
    "haircutPct" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "perUnitCap" DECIMAL(20,2),
    "closingPermitPct" DECIMAL(5,2) NOT NULL DEFAULT 80,
    "rateType" "BankRateType" NOT NULL DEFAULT 'FIXED',
    "aprPct" DECIMAL(6,3) NOT NULL DEFAULT 12,
    "indexPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "spreadPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "interestBasis" "BankInterestBasis" NOT NULL DEFAULT 'DRAWN',
    "originationPct" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "originationFlat" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "brokerPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "titleEscrowPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "closingFeePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "processingFee" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "budgetReviewFee" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "appraisalFee" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "legalFee" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "feesFinanced" BOOLEAN NOT NULL DEFAULT true,
    "servicingMonthly" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "inspectionFeePerDraw" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "drawProcessingFee" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "achFeePerBatch" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "hasInterestReserve" BOOLEAN NOT NULL DEFAULT false,
    "reserveInEnvelope" BOOLEAN NOT NULL DEFAULT false,
    "overfundingMode" "OverfundingMode" NOT NULL DEFAULT 'NONE',
    "reserveMonths" DECIMAL(4,1) NOT NULL DEFAULT 6,
    "releaseMode" "BankReleaseMode" NOT NULL DEFAULT 'SWEEP_FULL',
    "sweepPct" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "reconveyanceFee" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "termMonths" INTEGER NOT NULL DEFAULT 12,
    "extensionMonths" INTEGER NOT NULL DEFAULT 6,
    "extensionFeePct" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankProfile_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "BufferScenario" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "salePriceBufferPct" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "constructionCostBufferPct" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "lotCostBufferPct" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "closingFeePct" DECIMAL(6,2) NOT NULL DEFAULT 8,
    "contingencyReservePct" DECIMAL(6,2) NOT NULL DEFAULT 5,
    "landAcquisitionDays" INTEGER NOT NULL DEFAULT 15,
    "saleClosingDays" INTEGER NOT NULL DEFAULT 45,
    "constructionDurationBufferM" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "salesAbsorptionMonths" DECIMAL(4,1),
    "emdPct" DECIMAL(6,2) NOT NULL DEFAULT 10,
    "stressSlippagePct" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "unitGapDays" INTEGER NOT NULL DEFAULT 20,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BufferScenario_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogLocation_name_key" ON "CatalogLocation"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogModel_name_key" ON "CatalogModel"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogModelLocation_modelId_locationId_key" ON "CatalogModelLocation"("modelId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "BankProfile_name_key" ON "BankProfile"("name");

-- CreateIndex
CREATE INDEX "BankCustomFee_bankProfileId_idx" ON "BankCustomFee"("bankProfileId");

-- AddForeignKey
ALTER TABLE "PoolHouse" ADD CONSTRAINT "PoolHouse_catalogModelId_fkey" FOREIGN KEY ("catalogModelId") REFERENCES "CatalogModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolHouse" ADD CONSTRAINT "PoolHouse_catalogLocationId_fkey" FOREIGN KEY ("catalogLocationId") REFERENCES "CatalogLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogModelLocation" ADD CONSTRAINT "CatalogModelLocation_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "CatalogModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogModelLocation" ADD CONSTRAINT "CatalogModelLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "CatalogLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankCustomFee" ADD CONSTRAINT "BankCustomFee_bankProfileId_fkey" FOREIGN KEY ("bankProfileId") REFERENCES "BankProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankLoi" ADD CONSTRAINT "BankLoi_bankProfileId_fkey" FOREIGN KEY ("bankProfileId") REFERENCES "BankProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolSimulation" ADD CONSTRAINT "PoolSimulation_bankProfileId_fkey" FOREIGN KEY ("bankProfileId") REFERENCES "BankProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolSimulation" ADD CONSTRAINT "PoolSimulation_scenarioCode_fkey" FOREIGN KEY ("scenarioCode") REFERENCES "BufferScenario"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolLoan" ADD CONSTRAINT "PoolLoan_bankProfileId_fkey" FOREIGN KEY ("bankProfileId") REFERENCES "BankProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
