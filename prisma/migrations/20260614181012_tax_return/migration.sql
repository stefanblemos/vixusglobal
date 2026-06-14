-- CreateEnum
CREATE TYPE "TaxReturnStatus" AS ENUM ('ANALYZED', 'APPLIED');

-- CreateTable
CREATE TABLE "TaxReturn" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "companyId" TEXT,
    "matchedName" TEXT,
    "year" INTEGER,
    "jurisdiction" TEXT,
    "entityType" TEXT,
    "taxTreatment" TEXT,
    "taxForm" TEXT,
    "confidence" TEXT,
    "summary" TEXT,
    "owners" JSONB,
    "status" "TaxReturnStatus" NOT NULL DEFAULT 'ANALYZED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxReturn_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TaxReturn" ADD CONSTRAINT "TaxReturn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
