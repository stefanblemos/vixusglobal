-- CreateTable
CREATE TABLE "AssetYearDepreciation" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetYearDepreciation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetYearDepreciation_assetId_idx" ON "AssetYearDepreciation"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetYearDepreciation_assetId_year_key" ON "AssetYearDepreciation"("assetId", "year");

-- AddForeignKey
ALTER TABLE "AssetYearDepreciation" ADD CONSTRAINT "AssetYearDepreciation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "FixedAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
