-- AlterEnum
ALTER TYPE "QboReportKind" ADD VALUE 'GENERAL_LEDGER';

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "matchedCompanyId" TEXT,
    "matchedPartyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTxn" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "importId" TEXT,
    "account" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "num" TEXT,
    "vendorId" TEXT,
    "rawName" TEXT,
    "description" TEXT,
    "split" TEXT,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTxn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_normalizedKey_key" ON "Vendor"("normalizedKey");

-- CreateIndex
CREATE INDEX "LedgerTxn_companyId_account_idx" ON "LedgerTxn"("companyId", "account");

-- CreateIndex
CREATE INDEX "LedgerTxn_companyId_date_idx" ON "LedgerTxn"("companyId", "date");

-- AddForeignKey
ALTER TABLE "LedgerTxn" ADD CONSTRAINT "LedgerTxn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTxn" ADD CONSTRAINT "LedgerTxn_importId_fkey" FOREIGN KEY ("importId") REFERENCES "QboImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTxn" ADD CONSTRAINT "LedgerTxn_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
