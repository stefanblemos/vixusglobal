-- Performance genérica + gate de distribuição (06/10/2026).
-- 1) Pool: % do acordo + entidade de performance + política p/ o restante. Substitui
--    profitSharePct (fração do investidor; a edição gravava invertido). Migra: 0.65 → 35.
ALTER TABLE "InvestmentPool" ADD COLUMN IF NOT EXISTS "performancePct" DECIMAL(6,2);
ALTER TABLE "InvestmentPool" ADD COLUMN IF NOT EXISTS "performancePayeeCompanyId" TEXT;
ALTER TABLE "InvestmentPool" ADD COLUMN IF NOT EXISTS "performancePayeePartyId" TEXT;
ALTER TABLE "InvestmentPool" ADD COLUMN IF NOT EXISTS "performanceWaiveRemaining" BOOLEAN NOT NULL DEFAULT false;

UPDATE "InvestmentPool"
SET "performancePct" = ROUND((1 - "profitSharePct") * 100, 2)
WHERE "profitSharePct" IS NOT NULL AND "profitSharePct" > 0.005 AND "profitSharePct" < 0.995;
-- valores fora da faixa (ex.: 0.00 no VIX-3) ficam NULL p/ revisão manual

ALTER TABLE "InvestmentPool" DROP COLUMN IF EXISTS "profitSharePct";

ALTER TABLE "InvestmentPool"
  ADD CONSTRAINT "InvestmentPool_performancePayeeCompanyId_fkey"
  FOREIGN KEY ("performancePayeeCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvestmentPool"
  ADD CONSTRAINT "InvestmentPool_performancePayeePartyId_fkey"
  FOREIGN KEY ("performancePayeePartyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) Despesa PERFORMANCE: decisão tomada na distribuição de lucro (base, %, origem).
ALTER TABLE "PoolExpense" ADD COLUMN IF NOT EXISTS "distributionId" TEXT;
ALTER TABLE "PoolExpense" ADD COLUMN IF NOT EXISTS "basisAmount" DECIMAL(20,2);
ALTER TABLE "PoolExpense" ADD COLUMN IF NOT EXISTS "pctApplied" DECIMAL(6,2);

-- 3) Distribuição: justificativa quando passa do distribuível seguro / lucro antes do fim.
ALTER TABLE "PoolDistribution" ADD COLUMN IF NOT EXISTS "overrideNote" TEXT;
