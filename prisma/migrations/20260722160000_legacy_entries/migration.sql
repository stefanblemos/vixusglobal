-- Saldo de abertura vira LANÇAMENTOS datados (data + tipo + valor + projeto).
ALTER TABLE "InvestorLegacy" DROP COLUMN IF EXISTS "invested";
ALTER TABLE "InvestorLegacy" DROP COLUMN IF EXISTS "returned";
ALTER TABLE "InvestorLegacy" DROP COLUMN IF EXISTS "since";

CREATE TABLE IF NOT EXISTS "InvestorLegacyEntry" (
  "id" TEXT NOT NULL,
  "legacyId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" DECIMAL(20,2) NOT NULL,
  "label" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "InvestorLegacyEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InvestorLegacyEntry_legacyId_idx" ON "InvestorLegacyEntry"("legacyId");
DO $$ BEGIN
  ALTER TABLE "InvestorLegacyEntry" ADD CONSTRAINT "InvestorLegacyEntry_legacyId_fkey" FOREIGN KEY ("legacyId") REFERENCES "InvestorLegacy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
