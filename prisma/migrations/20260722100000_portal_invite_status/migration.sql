-- Portal (#68): estado do convite por investidor — convidado (invitedAt) → ativo (1º login).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastPortalLoginAt" TIMESTAMP(3);
ALTER TABLE "InvestorAccess" ADD COLUMN IF NOT EXISTS "invitedAt" TIMESTAMP(3);
