-- Chamada de capital com recebimento diferenciado (05/10/2026): cada linha guarda o pro rata
-- (amount) E o recebido de fato (receivedAmount) — parcial, zero ou acima (cobriu diferença).
ALTER TABLE "PoolCapitalCallLine" ADD COLUMN IF NOT EXISTS "receivedAmount" DECIMAL(20,2);
ALTER TABLE "PoolCapitalCallLine" ADD COLUMN IF NOT EXISTS "paidAt" DATE;

-- Linhas já pagas: recebido = pro rata (era a única regra), data = a do aporte gerado.
UPDATE "PoolCapitalCallLine" l
SET "receivedAmount" = l."amount",
    "paidAt" = COALESCE((SELECT c."date" FROM "PoolContribution" c WHERE c."id" = l."contributionId"), CURRENT_DATE)
WHERE l."paid" = true AND l."receivedAmount" IS NULL;
