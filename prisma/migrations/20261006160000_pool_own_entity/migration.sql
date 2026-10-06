-- Veículo do pool (06/10/2026): LLC própria (provisiona encerramento) × dentro de outra empresa.
ALTER TABLE "InvestmentPool" ADD COLUMN IF NOT EXISTS "ownEntity" BOOLEAN NOT NULL DEFAULT true;
