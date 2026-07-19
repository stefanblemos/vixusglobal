-- Ciclo de vida do draw (#draws): status, número sequencial e motivo de negativa.
ALTER TABLE "PoolLoanEntry" ADD COLUMN IF NOT EXISTS "drawStatus" TEXT;
ALTER TABLE "PoolLoanEntry" ADD COLUMN IF NOT EXISTS "drawNumber" INTEGER;
ALTER TABLE "PoolLoanEntry" ADD COLUMN IF NOT EXISTS "denyReason" TEXT;

-- Backfill: status derivado dos draws existentes (pendente = REQUESTED, senão APPROVED).
UPDATE "PoolLoanEntry"
   SET "drawStatus" = CASE WHEN "pending" THEN 'REQUESTED' ELSE 'APPROVED' END
 WHERE "type" = 'DRAW' AND "drawStatus" IS NULL;

-- Backfill da numeração: sequencial por loan, ordenado por data/criação.
WITH numbered AS (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "loanId" ORDER BY "date", "createdAt") AS n
    FROM "PoolLoanEntry"
   WHERE "type" = 'DRAW'
)
UPDATE "PoolLoanEntry" e
   SET "drawNumber" = numbered.n
  FROM numbered
 WHERE e."id" = numbered."id" AND e."drawNumber" IS NULL;
