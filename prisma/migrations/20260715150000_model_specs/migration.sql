-- Ficha do modelo (specs + tagline + descrição) p/ o card do Investment Summary
ALTER TABLE "CatalogModel" ADD COLUMN "beds" INTEGER;
ALTER TABLE "CatalogModel" ADD COLUMN "baths" DECIMAL(3,1);
ALTER TABLE "CatalogModel" ADD COLUMN "garageSpaces" INTEGER;
ALTER TABLE "CatalogModel" ADD COLUMN "builtSqft" INTEGER;
ALTER TABLE "CatalogModel" ADD COLUMN "tagline" TEXT;
ALTER TABLE "CatalogModel" ADD COLUMN "description" TEXT;
