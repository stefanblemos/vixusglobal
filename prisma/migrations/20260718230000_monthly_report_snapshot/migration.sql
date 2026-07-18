-- Report mensal (Fase 5, aprovado 19/07/2026): snapshot congelado do mês no PoolDocument
ALTER TABLE "PoolDocument" ADD COLUMN IF NOT EXISTS "reportMonth" TEXT;
ALTER TABLE "PoolDocument" ADD COLUMN IF NOT EXISTS "data" JSONB;
