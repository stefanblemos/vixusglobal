-- Inventory: regras por fornecedor (lista) + livros fechados até
CREATE TABLE "InventoryVendor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "closeHintTerms" TEXT[] DEFAULT ARRAY['cross-dock', 'cross dock', 'unloading', 'delivery']::TEXT[],
    "waitDays" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryVendor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryVendor_companyId_name_key" ON "InventoryVendor"("companyId", "name");
ALTER TABLE "InventoryVendor" ADD CONSTRAINT "InventoryVendor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- migra o vendor único do settings para a lista
INSERT INTO "InventoryVendor" ("id", "companyId", "name", "closeHintTerms", "waitDays", "updatedAt")
SELECT 'vnd_' || md5("companyId"), "companyId", "vendorName", "closeHintTerms", "waitDays", CURRENT_TIMESTAMP FROM "InventorySettings";

ALTER TABLE "InventorySettings" DROP COLUMN "waitDays", DROP COLUMN "closeHintTerms", DROP COLUMN "vendorName";
ALTER TABLE "InventorySettings" ADD COLUMN "booksClosedThrough" TEXT;
