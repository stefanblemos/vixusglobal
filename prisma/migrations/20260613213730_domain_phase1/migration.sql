-- CreateEnum
CREATE TYPE "PartyKind" AS ENUM ('PERSON', 'ENTITY');

-- CreateEnum
CREATE TYPE "Jurisdiction" AS ENUM ('PT', 'BR', 'US', 'OTHER');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('LLC', 'C_CORP', 'S_CORP', 'PA', 'LP', 'LLP', 'SOLE_PROP', 'LTDA', 'SLU', 'SA', 'MEI', 'EI', 'LDA', 'UNIPESSOAL_LDA', 'ENI', 'OTHER');

-- CreateEnum
CREATE TYPE "CompanyRelationship" AS ENUM ('GROUP_MEMBER', 'MANAGED_ONLY');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('MANUAL', 'QBO_IMPORT', 'LOAN');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'PAID', 'DEFAULTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LoanInterestMethod" AS ENUM ('SIMPLE', 'COMPOUND');

-- CreateEnum
CREATE TYPE "DayCountBasis" AS ENUM ('ACT_365', 'ACT_360', 'D30_360');

-- CreateEnum
CREATE TYPE "LoanTxnType" AS ENUM ('DISBURSEMENT', 'ORIGINATION_FEE', 'INTEREST_ACCRUAL', 'REPAYMENT_PRINCIPAL', 'REPAYMENT_INTEREST', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "kind" "PartyKind" NOT NULL,
    "name" TEXT NOT NULL,
    "taxJurisdiction" "Jurisdiction" NOT NULL DEFAULT 'OTHER',
    "taxId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "jurisdiction" "Jurisdiction" NOT NULL,
    "state" TEXT,
    "entityType" "EntityType" NOT NULL,
    "taxId" TEXT,
    "fiscalYearEnd" TEXT NOT NULL DEFAULT '12-31',
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "relationship" "CompanyRelationship" NOT NULL,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ownership" (
    "id" TEXT NOT NULL,
    "ownerPartyId" TEXT,
    "ownerCompanyId" TEXT,
    "ownedCompanyId" TEXT,
    "ownedPartyId" TEXT,
    "percentage" DECIMAL(9,6) NOT NULL,
    "shareClass" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ownership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "source" "JournalSource" NOT NULL DEFAULT 'MANUAL',
    "reference" TEXT,
    "loanTxnId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "fxRate" DECIMAL(18,8),
    "memo" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntercompanyLoan" (
    "id" TEXT NOT NULL,
    "lenderCompanyId" TEXT NOT NULL,
    "borrowerCompanyId" TEXT NOT NULL,
    "principal" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "annualInterestRate" DECIMAL(9,6) NOT NULL,
    "interestMethod" "LoanInterestMethod" NOT NULL DEFAULT 'SIMPLE',
    "dayCountBasis" "DayCountBasis" NOT NULL DEFAULT 'ACT_365',
    "originationFeeRate" DECIMAL(9,6) NOT NULL DEFAULT 0.01,
    "startDate" TIMESTAMP(3) NOT NULL,
    "maturityDate" TIMESTAMP(3),
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntercompanyLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanTransaction" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "type" "LoanTxnType" NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_companyId_code_key" ON "LedgerAccount"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_loanTxnId_key" ON "JournalEntry"("loanTxnId");

-- AddForeignKey
ALTER TABLE "Ownership" ADD CONSTRAINT "Ownership_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ownership" ADD CONSTRAINT "Ownership_ownerCompanyId_fkey" FOREIGN KEY ("ownerCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ownership" ADD CONSTRAINT "Ownership_ownedCompanyId_fkey" FOREIGN KEY ("ownedCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ownership" ADD CONSTRAINT "Ownership_ownedPartyId_fkey" FOREIGN KEY ("ownedPartyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntercompanyLoan" ADD CONSTRAINT "IntercompanyLoan_lenderCompanyId_fkey" FOREIGN KEY ("lenderCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntercompanyLoan" ADD CONSTRAINT "IntercompanyLoan_borrowerCompanyId_fkey" FOREIGN KEY ("borrowerCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanTransaction" ADD CONSTRAINT "LoanTransaction_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "IntercompanyLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
