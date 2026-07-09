-- AlterTable
ALTER TABLE "PoolHouse" ADD COLUMN     "catalogLocationId" TEXT,
ADD COLUMN     "catalogModelId" TEXT;

-- AddForeignKey
ALTER TABLE "PoolHouse" ADD CONSTRAINT "PoolHouse_catalogModelId_fkey" FOREIGN KEY ("catalogModelId") REFERENCES "CatalogModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolHouse" ADD CONSTRAINT "PoolHouse_catalogLocationId_fkey" FOREIGN KEY ("catalogLocationId") REFERENCES "CatalogLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

