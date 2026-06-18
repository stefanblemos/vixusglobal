-- CreateTable
CREATE TABLE "ObligationStatus" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'FILED',
    "filedDate" DATE,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObligationStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ObligationStatus_companyId_idx" ON "ObligationStatus"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ObligationStatus_companyId_key_periodKey_key" ON "ObligationStatus"("companyId", "key", "periodKey");

-- AddForeignKey
ALTER TABLE "ObligationStatus" ADD CONSTRAINT "ObligationStatus_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
