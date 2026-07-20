-- Budget/SOV passa a ser POR CASA (não por loan). Sem dados reais → recria coluna limpa.
ALTER TABLE "LoanBudgetLine" DROP CONSTRAINT IF EXISTS "LoanBudgetLine_loanId_fkey";
DROP INDEX IF EXISTS "LoanBudgetLine_loanId_idx";
ALTER TABLE "LoanBudgetLine" DROP COLUMN IF EXISTS "loanId";
ALTER TABLE "LoanBudgetLine" ADD COLUMN IF NOT EXISTS "houseId" TEXT;
ALTER TABLE "LoanBudgetLine" ADD COLUMN IF NOT EXISTS "amount" DECIMAL(20,2);
DELETE FROM "LoanBudgetLine" WHERE "houseId" IS NULL; -- nenhuma linha real
ALTER TABLE "LoanBudgetLine" ALTER COLUMN "houseId" SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE "LoanBudgetLine" ADD CONSTRAINT "LoanBudgetLine_houseId_fkey"
    FOREIGN KEY ("houseId") REFERENCES "PoolHouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "LoanBudgetLine_houseId_idx" ON "LoanBudgetLine"("houseId");
