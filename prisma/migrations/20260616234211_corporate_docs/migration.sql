-- CreateTable
CREATE TABLE "CorporateDoc" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "matchedName" TEXT,
    "docType" TEXT NOT NULL,
    "year" INTEGER,
    "jurisdiction" TEXT,
    "state" TEXT,
    "docNumber" TEXT,
    "taxId" TEXT,
    "formationDate" TEXT,
    "filingDate" TEXT,
    "status" TEXT,
    "registeredAgent" JSONB,
    "principalAddress" TEXT,
    "mailingAddress" TEXT,
    "people" JSONB,
    "fileName" TEXT NOT NULL,
    "pdf" BYTEA,
    "pdfSize" INTEGER,
    "confidence" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorporateDoc_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CorporateDoc" ADD CONSTRAINT "CorporateDoc_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
