-- CreateEnum
CREATE TYPE "QboReportKind" AS ENUM ('BALANCE_SHEET', 'PROFIT_AND_LOSS', 'UNKNOWN');

-- CreateTable
CREATE TABLE "QboImport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "sourceCompanyName" TEXT NOT NULL,
    "reportKind" "QboReportKind" NOT NULL,
    "reportTypeLabel" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "basis" TEXT,
    "fileName" TEXT,
    "columns" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QboImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QboImportLine" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "accountCode" TEXT,
    "sectionPath" TEXT[],
    "depth" INTEGER NOT NULL,
    "lineType" TEXT NOT NULL,
    "value" DECIMAL(20,4),
    "currency" TEXT NOT NULL DEFAULT 'USD',

    CONSTRAINT "QboImportLine_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "QboImport" ADD CONSTRAINT "QboImport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QboImportLine" ADD CONSTRAINT "QboImportLine_importId_fkey" FOREIGN KEY ("importId") REFERENCES "QboImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
