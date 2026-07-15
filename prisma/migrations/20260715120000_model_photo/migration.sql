-- Foto/render do modelo p/ o Investment Summary (data URI + dimensões p/ o DOCX)
ALTER TABLE "CatalogModel" ADD COLUMN "photo" TEXT;
ALTER TABLE "CatalogModel" ADD COLUMN "photoWidth" INTEGER;
ALTER TABLE "CatalogModel" ADD COLUMN "photoHeight" INTEGER;
