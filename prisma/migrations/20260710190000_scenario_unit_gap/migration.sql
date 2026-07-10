-- AlterTable
ALTER TABLE "BufferScenario" ADD COLUMN     "unitGapDays" INTEGER NOT NULL DEFAULT 20;


-- Gap por cenário (pedido do Stefan 10/07): Ótimo 10 · Real 20 (default) · Conservador 30
UPDATE "BufferScenario" SET "unitGapDays" = 10 WHERE "code" = 'OPT';
UPDATE "BufferScenario" SET "unitGapDays" = 30 WHERE "code" = 'CONS';
