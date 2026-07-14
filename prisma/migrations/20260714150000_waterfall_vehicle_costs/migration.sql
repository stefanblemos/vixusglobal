-- Waterfall default da Vixus + custos estimados do veículo (catálogo)
CREATE TYPE "VehicleCostTiming" AS ENUM ('FORMATION', 'DISSOLUTION', 'ANNUAL', 'MONTHLY');
CREATE TABLE "CatalogWaterfallTier" (
    "id" TEXT NOT NULL,
    "hurdlePct" DECIMAL(6,2),
    "promotePct" DECIMAL(6,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CatalogWaterfallTier_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CatalogVehicleCost" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "timing" "VehicleCostTiming" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CatalogVehicleCost_pkey" PRIMARY KEY ("id")
);
