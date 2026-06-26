-- CreateTable
CREATE TABLE "StateTaxFiling" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'FL',
    "taxYear" INTEGER NOT NULL,
    "principal" DECIMAL(20,2) NOT NULL,
    "penalty" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "interest" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "paidDate" DATE,
    "source" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StateTaxFiling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StateTaxFiling_companyId_idx" ON "StateTaxFiling"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "StateTaxFiling_companyId_jurisdiction_taxYear_key" ON "StateTaxFiling"("companyId", "jurisdiction", "taxYear");

-- AddForeignKey
ALTER TABLE "StateTaxFiling" ADD CONSTRAINT "StateTaxFiling_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
