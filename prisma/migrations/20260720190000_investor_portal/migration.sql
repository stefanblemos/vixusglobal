-- Portal do investidor (#68): vínculo User↔entidade (multi) + token de magic-link.
CREATE TABLE IF NOT EXISTS "InvestorAccess" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "partyId" TEXT,
  "companyId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvestorAccess_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InvestorAccess_userId_partyId_key" ON "InvestorAccess"("userId","partyId");
CREATE UNIQUE INDEX IF NOT EXISTS "InvestorAccess_userId_companyId_key" ON "InvestorAccess"("userId","companyId");
CREATE INDEX IF NOT EXISTS "InvestorAccess_userId_idx" ON "InvestorAccess"("userId");
DO $$ BEGIN
  ALTER TABLE "InvestorAccess" ADD CONSTRAINT "InvestorAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "InvestorAccess" ADD CONSTRAINT "InvestorAccess_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "InvestorAccess" ADD CONSTRAINT "InvestorAccess_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "PortalLoginToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PortalLoginToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PortalLoginToken_tokenHash_key" ON "PortalLoginToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "PortalLoginToken_email_idx" ON "PortalLoginToken"("email");
