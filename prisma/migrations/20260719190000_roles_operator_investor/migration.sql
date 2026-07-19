-- #67 (Leva 2): papéis OPERATOR e INVESTOR no módulo Investments/portal.
-- ADD VALUE IF NOT EXISTS é idempotente (PG 12+); só adiciona valores ao enum existente.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OPERATOR';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'INVESTOR';
