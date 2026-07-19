-- Audit log do módulo Investments (#65): trilha de quem alterou o quê nas ações sensíveis.
CREATE TABLE IF NOT EXISTS "InvestmentAudit" (
  "id" TEXT NOT NULL,
  "poolId" TEXT,
  "entity" TEXT NOT NULL,
  "entityId" TEXT,
  "action" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "changedBy" TEXT NOT NULL,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvestmentAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InvestmentAudit_poolId_idx" ON "InvestmentAudit"("poolId");
CREATE INDEX IF NOT EXISTS "InvestmentAudit_createdAt_idx" ON "InvestmentAudit"("createdAt");
