-- CreateTable
CREATE TABLE "TaxReserveRate" (
    "companyId" TEXT NOT NULL,
    "ratePct" DECIMAL(5,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxReserveRate_pkey" PRIMARY KEY ("companyId")
);
