-- Retificação de IR: a declaração antiga aponta para a nova e sai dos cálculos (fica no histórico).
ALTER TABLE "TaxReturn" ADD COLUMN IF NOT EXISTS "supersededById" TEXT;
ALTER TABLE "TaxReturn" ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3);
ALTER TABLE "TaxReturn" ADD COLUMN IF NOT EXISTS "amendmentNote" TEXT;
CREATE INDEX IF NOT EXISTS "TaxReturn_companyId_year_idx" ON "TaxReturn"("companyId","year");
DO $$ BEGIN
  ALTER TABLE "TaxReturn" ADD CONSTRAINT "TaxReturn_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "TaxReturn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
