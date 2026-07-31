-- Banco cobra a inspeção à parte (invoice depois), não descontada do draw. Quando true, a baixa
-- do draw não lança a inspection automática e alerta na hora de registrar a liberação.
ALTER TABLE "BankProfile" ADD COLUMN IF NOT EXISTS "inspectionBilledSeparately" BOOLEAN NOT NULL DEFAULT false;
