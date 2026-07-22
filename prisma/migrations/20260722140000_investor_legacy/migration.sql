-- Saldo de abertura do investidor (projetos anteriores encerrados, agregado do ADMIN).
CREATE TABLE IF NOT EXISTS "InvestorLegacy" (
  "id" TEXT NOT NULL,
  "partyId" TEXT,
  "companyId" TEXT,
  "invested" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "returned" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "since" DATE,
  "note" TEXT,
  "lockedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvestorLegacy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InvestorLegacy_partyId_key" ON "InvestorLegacy"("partyId");
CREATE UNIQUE INDEX IF NOT EXISTS "InvestorLegacy_companyId_key" ON "InvestorLegacy"("companyId");
DO $$ BEGIN
  ALTER TABLE "InvestorLegacy" ADD CONSTRAINT "InvestorLegacy_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "InvestorLegacy" ADD CONSTRAINT "InvestorLegacy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
