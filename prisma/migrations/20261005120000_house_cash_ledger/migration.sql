-- Extrato da casa (05/10/2026): lançamentos de capital próprio / custos / devolução ao pool.
-- ownCapital, actualLotCost e actualBuildCost passam a ser CACHE da soma deste extrato.
CREATE TYPE "HouseCashKind" AS ENUM ('EQUITY_IN', 'COST', 'RETURN_TO_POOL');

CREATE TABLE "HouseCashEntry" (
  "id"        TEXT NOT NULL,
  "houseId"   TEXT NOT NULL,
  "kind"      "HouseCashKind" NOT NULL,
  "category"  TEXT NOT NULL,
  "date"      DATE NOT NULL,
  "opening"   BOOLEAN NOT NULL DEFAULT false,
  "amount"    DECIMAL(20,2) NOT NULL,
  "memo"      TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HouseCashEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HouseCashEntry_houseId_idx" ON "HouseCashEntry"("houseId");

ALTER TABLE "HouseCashEntry"
  ADD CONSTRAINT "HouseCashEntry_houseId_fkey"
  FOREIGN KEY ("houseId") REFERENCES "PoolHouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Saldo de abertura: os valores digitados hoje viram 1 lançamento cada, marcados como
-- "abertura" (não há data real). Nenhum total muda — ownCapital = soma dos EQUITY_IN.
INSERT INTO "HouseCashEntry" ("id", "houseId", "kind", "category", "date", "opening", "amount", "memo")
SELECT gen_random_uuid()::text, h."id", 'EQUITY_IN', 'OPENING',
       COALESCE(h."lotPaidDate", p."startDate", h."createdAt"::date), true, h."ownCapital",
       'Saldo de abertura (capital próprio digitado na ficha antiga)'
FROM "PoolHouse" h JOIN "InvestmentPool" p ON p."id" = h."poolId"
WHERE h."ownCapital" IS NOT NULL AND h."ownCapital" <> 0;

INSERT INTO "HouseCashEntry" ("id", "houseId", "kind", "category", "date", "opening", "amount", "memo")
SELECT gen_random_uuid()::text, h."id", 'COST', 'LOT',
       COALESCE(h."lotPaidDate", p."startDate", h."createdAt"::date), true, h."actualLotCost",
       'Saldo de abertura (lote real digitado na ficha antiga)'
FROM "PoolHouse" h JOIN "InvestmentPool" p ON p."id" = h."poolId"
WHERE h."actualLotCost" IS NOT NULL AND h."actualLotCost" <> 0;

INSERT INTO "HouseCashEntry" ("id", "houseId", "kind", "category", "date", "opening", "amount", "memo")
SELECT gen_random_uuid()::text, h."id", 'COST', 'BUILD',
       COALESCE(h."buildStartDate", h."lotPaidDate", p."startDate", h."createdAt"::date), true, h."actualBuildCost",
       'Saldo de abertura (obra real digitada na ficha antiga)'
FROM "PoolHouse" h JOIN "InvestmentPool" p ON p."id" = h."poolId"
WHERE h."actualBuildCost" IS NOT NULL AND h."actualBuildCost" <> 0;
