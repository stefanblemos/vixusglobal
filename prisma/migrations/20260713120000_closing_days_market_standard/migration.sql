-- Closings como o mercado funciona (regra do Stefan 13/07/2026):
-- 1. saleClosingDays: contrato do comprador → dinheiro no caixa (padrão 45d)
-- 2. landAcquisitionDays muda de semântica: era "atraso de compra", vira ESCROW do lote
--    (caução → closing) — padrão de mercado 15d nos 3 cenários core
-- 3. parallelPermit morre: permit só conta a partir do pagamento do lote
ALTER TABLE "BufferScenario" ADD COLUMN "saleClosingDays" INTEGER NOT NULL DEFAULT 45;
ALTER TABLE "BufferScenario" ALTER COLUMN "landAcquisitionDays" SET DEFAULT 15;
UPDATE "BufferScenario" SET "landAcquisitionDays" = 15 WHERE "code" IN ('OPT', 'REAL', 'CONS');
ALTER TABLE "PoolSimulation" DROP COLUMN "parallelPermit";
