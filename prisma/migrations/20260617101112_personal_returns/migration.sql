-- CreateTable
CREATE TABLE "PersonalReturn" (
    "id" TEXT NOT NULL,
    "partyId" TEXT,
    "matchedName" TEXT,
    "spouseName" TEXT,
    "ssnLast4" TEXT,
    "spouseSsnLast4" TEXT,
    "year" INTEGER,
    "filingStatus" TEXT,
    "form" TEXT,
    "preparer" TEXT,
    "wages" DECIMAL(20,2),
    "businessIncomeC" DECIMAL(20,2),
    "capitalGain" DECIMAL(20,2),
    "rentalIncome" DECIMAL(20,2),
    "partnershipIncome" DECIMAL(20,2),
    "partnershipLoss" DECIMAL(20,2),
    "totalIncome" DECIMAL(20,2),
    "agi" DECIMAL(20,2),
    "taxableIncome" DECIMAL(20,2),
    "totalTax" DECIMAL(20,2),
    "seTax" DECIMAL(20,2),
    "qbiDeduction" DECIMAL(20,2),
    "confidence" TEXT,
    "summary" TEXT,
    "fileName" TEXT NOT NULL,
    "pdf" BYTEA,
    "pdfSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalReturn_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PersonalReturn" ADD CONSTRAINT "PersonalReturn_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
