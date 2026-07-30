-- #draws — solicitação de draw ao banco: pin/lockbox na casa, data real de comunicação no
-- draw, e template de mensagem por banco. Tudo idempotente (build da Vercel roda migrate deploy).

ALTER TABLE "PoolHouse" ADD COLUMN IF NOT EXISTS "pinLocation" TEXT;
ALTER TABLE "PoolHouse" ADD COLUMN IF NOT EXISTS "lockboxCode" TEXT;

ALTER TABLE "PoolLoanEntry" ADD COLUMN IF NOT EXISTS "bankNotifiedAt" DATE;

ALTER TABLE "BankProfile" ADD COLUMN IF NOT EXISTS "drawRequestTemplate" TEXT;
