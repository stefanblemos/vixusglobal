-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('DISREGARDED', 'PARTNERSHIP', 'S_CORP', 'C_CORP', 'SOLE_PROP', 'LUCRO_REAL', 'LUCRO_PRESUMIDO', 'SIMPLES_NACIONAL', 'MEI', 'REGIME_GERAL', 'REGIME_SIMPLIFICADO', 'OTHER');

-- CreateTable
CREATE TABLE "CompanyTaxStatus" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "taxTreatment" "TaxTreatment" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyTaxStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyTaxStatus_companyId_year_key" ON "CompanyTaxStatus"("companyId", "year");

-- AddForeignKey
ALTER TABLE "CompanyTaxStatus" ADD CONSTRAINT "CompanyTaxStatus_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
