-- CreateTable
CREATE TABLE "TaxRateYear" (
    "year" INTEGER NOT NULL,
    "corpPct" DECIMAL(5,2) NOT NULL DEFAULT 21,
    "passPct" DECIMAL(5,2) NOT NULL DEFAULT 30,
    "flPct" DECIMAL(5,2) NOT NULL DEFAULT 5.5,
    "flExemption" DECIMAL(20,2) NOT NULL DEFAULT 50000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRateYear_pkey" PRIMARY KEY ("year")
);
