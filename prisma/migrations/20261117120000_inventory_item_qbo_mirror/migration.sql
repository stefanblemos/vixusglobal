-- Inventory: espelho do QBO no item (preço/custo do último CSV) + custo vigente só com frete fechado
ALTER TABLE "InventoryItem" ADD COLUMN "qboPrice" DECIMAL(14,4), ADD COLUMN "qboCost" DECIMAL(14,4), ADD COLUMN "qboAt" DATE;
-- custo que veio do CSV (sem frete) não é custo vigente: limpa onde não há embarque fechado por trás
UPDATE "InventoryItem" SET "qboCost" = "currentCost", "currentCost" = NULL, "currentCostAt" = NULL WHERE "currentCost" IS NOT NULL AND "currentCostShipmentId" IS NULL;
