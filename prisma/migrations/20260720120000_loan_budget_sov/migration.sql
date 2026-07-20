-- Leva 2 dos marcos: Schedule of Values/budget do banco + retainage + nº de draws esperado.
ALTER TABLE "PoolLoan" ADD COLUMN IF NOT EXISTS "retainagePct" DECIMAL(6,3);
ALTER TABLE "PoolLoan" ADD COLUMN IF NOT EXISTS "expectedDraws" INTEGER;

CREATE TABLE IF NOT EXISTS "LoanBudgetLine" (
  "id" TEXT NOT NULL,
  "loanId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "pct" DECIMAL(6,3) NOT NULL DEFAULT 0,
  "milestoneKey" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LoanBudgetLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LoanBudgetLine_loanId_idx" ON "LoanBudgetLine"("loanId");
DO $$ BEGIN
  ALTER TABLE "LoanBudgetLine" ADD CONSTRAINT "LoanBudgetLine_loanId_fkey"
    FOREIGN KEY ("loanId") REFERENCES "PoolLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
