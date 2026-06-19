-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "acquisitionDate" DATE NOT NULL,
    "cost" DECIMAL(20,4) NOT NULL,
    "recoveryYears" DECIMAL(4,1) NOT NULL,
    "method" TEXT NOT NULL,
    "section179" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "bonusPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "disposalDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FixedAsset_companyId_idx" ON "FixedAsset"("companyId");

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
