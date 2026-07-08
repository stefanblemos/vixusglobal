-- CreateEnum
CREATE TYPE "HouseType" AS ENUM ('AFFORDABLE', 'MID_RANGE', 'UPPER_MIDDLE', 'HIGH_END', 'LUXURY', 'DUPLEX', 'TRIPLEX', 'MULTIFAMILY');

-- CreateEnum
CREATE TYPE "SimFundingMode" AS ENUM ('EQUITY', 'BANK');

-- CreateEnum
CREATE TYPE "BuilderCompMode" AS ENUM ('CONTRACTOR_FEE', 'PERFORMANCE');

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
CREATE TABLE "CatalogModel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "houseType" "HouseType" NOT NULL,
    "buildMonths" DECIMAL(4,1) NOT NULL,
    "directCost" DECIMAL(20,2) NOT NULL,
    "contractorFee" DECIMAL(20,2),
    "notes" TEXT,
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
    "lotCost" DECIMAL(20,2),

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
    "aprPct" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "originationPct" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "originationFlat" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "closingFeePct" DECIMAL(5,2) NOT NULL DEFAULT 3,
    "appraisalFee" DECIMAL(20,2) NOT NULL DEFAULT 1500,
    "legalFee" DECIMAL(20,2) NOT NULL DEFAULT 1800,
    "inspectionFeePerDraw" DECIMAL(20,2) NOT NULL DEFAULT 205,
    "servicingMonthly" DECIMAL(20,2) NOT NULL DEFAULT 95,
    "hasInterestReserve" BOOLEAN NOT NULL DEFAULT false,
    "feesFinanced" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankProfile_pkey" PRIMARY KEY ("id")
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
    "landAcquisitionDays" INTEGER NOT NULL DEFAULT 20,
    "constructionDurationBufferM" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "salesAbsorptionMonths" DECIMAL(4,1),
    "emdPct" DECIMAL(6,2) NOT NULL DEFAULT 10,
    "stressSlippagePct" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BufferScenario_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "PoolSimulation" (
    "id" TEXT NOT NULL,
    "poolId" TEXT,
    "name" TEXT NOT NULL,
    "fundingMode" "SimFundingMode" NOT NULL DEFAULT 'BANK',
    "bankProfileId" TEXT,
    "scenarioCode" TEXT NOT NULL DEFAULT 'REAL',
    "compMode" "BuilderCompMode" NOT NULL DEFAULT 'PERFORMANCE',
    "perfPct" DECIMAL(5,2) NOT NULL DEFAULT 35,
    "equityGatePct" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "parallelPermit" BOOLEAN NOT NULL DEFAULT false,
    "unitGapDays" INTEGER NOT NULL DEFAULT 3,
    "units" JSONB NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoolSimulation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogLocation_name_key" ON "CatalogLocation"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogModel_name_key" ON "CatalogModel"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogModelLocation_modelId_locationId_key" ON "CatalogModelLocation"("modelId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "BankProfile_name_key" ON "BankProfile"("name");

-- AddForeignKey
ALTER TABLE "CatalogModelLocation" ADD CONSTRAINT "CatalogModelLocation_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "CatalogModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogModelLocation" ADD CONSTRAINT "CatalogModelLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "CatalogLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolSimulation" ADD CONSTRAINT "PoolSimulation_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "InvestmentPool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolSimulation" ADD CONSTRAINT "PoolSimulation_bankProfileId_fkey" FOREIGN KEY ("bankProfileId") REFERENCES "BankProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolSimulation" ADD CONSTRAINT "PoolSimulation_scenarioCode_fkey" FOREIGN KEY ("scenarioCode") REFERENCES "BufferScenario"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
