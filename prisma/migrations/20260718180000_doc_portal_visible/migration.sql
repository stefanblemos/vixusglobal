-- Data room (Fase 3, 18/07/2026): flag de visibilidade no portal do investidor,
-- nos docs dos loans (agregados) e nos docs do pool (upload por categoria)
ALTER TABLE "PoolLoanDocument" ADD COLUMN IF NOT EXISTS "portalVisible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PoolDocument" ADD COLUMN IF NOT EXISTS "portalVisible" BOOLEAN NOT NULL DEFAULT false;
