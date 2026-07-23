-- #69 — Conta de recebimento das distribuições (saída de dinheiro) + pagamento por linha.
-- Conta por entidade investidora (Party/Company), reutilizável entre pools. Ciclo de vida
-- anti-fraude: DRAFT (operador preenche / sócio edita) → CONFIRMED (sócio atesta no portal).

CREATE TABLE IF NOT EXISTS "PayoutAccount" (
  "id"               TEXT NOT NULL,
  "partyId"          TEXT,
  "companyId"        TEXT,
  "beneficiaryName"  TEXT NOT NULL,
  "bankName"         TEXT NOT NULL,
  "routingNumber"    TEXT,
  "accountNumber"    TEXT NOT NULL,
  "accountType"      TEXT,
  "swift"            TEXT,
  "iban"             TEXT,
  "bankAddress"      TEXT,
  "status"           TEXT NOT NULL DEFAULT 'DRAFT',
  "enteredByEmail"   TEXT,
  "confirmedAt"      TIMESTAMP(3),
  "confirmedByEmail" TEXT,
  "confirmIp"        TEXT,
  "confirmHash"      TEXT,
  "keyHash"          TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayoutAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PayoutAccount_partyId_key" ON "PayoutAccount"("partyId");
CREATE UNIQUE INDEX IF NOT EXISTS "PayoutAccount_companyId_key" ON "PayoutAccount"("companyId");

DO $$ BEGIN
  ALTER TABLE "PayoutAccount"
    ADD CONSTRAINT "PayoutAccount_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "PayoutAccount"
    ADD CONSTRAINT "PayoutAccount_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Pagamento por linha da distribuição (accrual ≠ pagamento).
ALTER TABLE "PoolDistributionLine" ADD COLUMN IF NOT EXISTS "paidStatus"  TEXT NOT NULL DEFAULT 'UNPAID';
ALTER TABLE "PoolDistributionLine" ADD COLUMN IF NOT EXISTS "paidAt"      TIMESTAMP(3);
ALTER TABLE "PoolDistributionLine" ADD COLUMN IF NOT EXISTS "paidByEmail" TEXT;
ALTER TABLE "PoolDistributionLine" ADD COLUMN IF NOT EXISTS "paidRef"     TEXT;
