-- Subscrição online (mock aprovado 19/07/2026): perfil KYC reutilizável por entidade
-- investidora + subscrição com token público, assinatura click-wrap e aceite do Manager.
DO $$ BEGIN
  CREATE TYPE "PoolSubscriptionStatus" AS ENUM ('INVITED', 'IN_PROGRESS', 'SIGNED', 'ACCEPTED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "InvestorProfile" (
  "id" TEXT NOT NULL,
  "partyId" TEXT,
  "companyId" TEXT,
  "data" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvestorProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InvestorProfile_partyId_key" ON "InvestorProfile"("partyId");
CREATE UNIQUE INDEX IF NOT EXISTS "InvestorProfile_companyId_key" ON "InvestorProfile"("companyId");
DO $$ BEGIN
  ALTER TABLE "InvestorProfile" ADD CONSTRAINT "InvestorProfile_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InvestorProfile" ADD CONSTRAINT "InvestorProfile_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PoolSubscription" (
  "id" TEXT NOT NULL,
  "poolId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "email" TEXT,
  "partyId" TEXT,
  "companyId" TEXT,
  "units" DECIMAL(20,4),
  "unitPrice" DECIMAL(20,2) NOT NULL DEFAULT 1000,
  "status" "PoolSubscriptionStatus" NOT NULL DEFAULT 'INVITED',
  "data" JSONB,
  "prefilled" BOOLEAN NOT NULL DEFAULT false,
  "signName" TEXT,
  "signIp" TEXT,
  "signHash" TEXT,
  "signedAt" TIMESTAMP(3),
  "memberId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PoolSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PoolSubscription_token_key" ON "PoolSubscription"("token");
CREATE INDEX IF NOT EXISTS "PoolSubscription_poolId_idx" ON "PoolSubscription"("poolId");
DO $$ BEGIN
  ALTER TABLE "PoolSubscription" ADD CONSTRAINT "PoolSubscription_poolId_fkey"
    FOREIGN KEY ("poolId") REFERENCES "InvestmentPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PoolSubscription" ADD CONSTRAINT "PoolSubscription_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PoolSubscription" ADD CONSTRAINT "PoolSubscription_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PoolSubscription" ADD CONSTRAINT "PoolSubscription_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "PoolMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
