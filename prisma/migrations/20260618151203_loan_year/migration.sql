-- CreateTable
CREATE TABLE "LoanYear" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "annualRatePct" DECIMAL(9,4),
    "principalAdded" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "principalRepaid" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "interestAccrued" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "interestPaid" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanYear_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoanYear_loanId_year_key" ON "LoanYear"("loanId", "year");

-- AddForeignKey
ALTER TABLE "LoanYear" ADD CONSTRAINT "LoanYear_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "IntercompanyLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
