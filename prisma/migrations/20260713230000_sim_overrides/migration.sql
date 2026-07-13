-- Aba Premissas: overrides de catálogo por simulação (só o que diverge)
ALTER TABLE "PoolSimulation" ADD COLUMN "overrides" JSONB;
