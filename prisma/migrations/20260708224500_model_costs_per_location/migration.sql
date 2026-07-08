-- Custos de obra passam a ser POR local (costPerformance / costContractor) e o lote sai do
-- vínculo modelo-local (vem sempre do location). Backfill: o directCost do modelo vira o
-- costPerformance de cada local antes de dropar as colunas antigas.

ALTER TABLE "CatalogModelLocation" ADD COLUMN "costPerformance" DECIMAL(20,2);
ALTER TABLE "CatalogModelLocation" ADD COLUMN "costContractor" DECIMAL(20,2);

UPDATE "CatalogModelLocation" ml
SET "costPerformance" = m."directCost"
FROM "CatalogModel" m
WHERE m."id" = ml."modelId";

ALTER TABLE "CatalogModelLocation" DROP COLUMN "lotCost";

ALTER TABLE "CatalogModel" DROP COLUMN "directCost";
