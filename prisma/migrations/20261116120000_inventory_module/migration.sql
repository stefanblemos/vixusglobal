-- CreateEnum
CREATE TYPE "InventoryInvoiceKind" AS ENUM ('GOODS', 'FREIGHT', 'SAMPLE');

-- AlterTable

-- CreateTable
CREATE TABLE "InventorySettings" (
    "companyId" TEXT NOT NULL,
    "marginPct" DECIMAL(6,2) NOT NULL DEFAULT 15,
    "waitDays" INTEGER NOT NULL DEFAULT 30,
    "closeHintTerms" TEXT[] DEFAULT ARRAY['cross-dock', 'cross dock', 'unloading', 'delivery']::TEXT[],
    "vendorName" TEXT NOT NULL DEFAULT 'Archway Trade LLC',
    "glInventoryAccount" TEXT NOT NULL DEFAULT 'Inventory Asset',
    "glFreightAccount" TEXT NOT NULL DEFAULT 'Inventory Asset - Freight & Handling',
    "glCogsMaterialAccount" TEXT NOT NULL DEFAULT 'Supplies & materials - COGS',
    "glCogsFreightAccount" TEXT NOT NULL DEFAULT 'Shipping and Handling',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventorySettings_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "glNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vendorNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "listPrice" DECIMAL(14,4),
    "listPriceAt" DATE,
    "currentCost" DECIMAL(14,4),
    "currentCostAt" DATE,
    "currentCostShipmentId" TEXT,
    "qtyOnHand" DECIMAL(14,2),
    "qtyAt" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItemPrice" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "price" DECIMAL(14,4) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryItemPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "InventoryInvoiceKind" NOT NULL,
    "containers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "memo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "payment" DECIMAL(14,2),
    "balance" DECIMAL(14,2),
    "linesOk" BOOLEAN NOT NULL DEFAULT true,
    "shipmentId" TEXT,
    "pinShipmentId" TEXT,
    "sampleTargetItemId" TEXT,
    "sampleWrittenOffAt" DATE,
    "lateAdjustment" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "fileName" TEXT,
    "pdf" BYTEA,
    "pdfSize" INTEGER,
    "glNum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryInvoiceVersion" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT,
    "replacedBy" TEXT,
    "replacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryInvoiceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "activity" TEXT NOT NULL,
    "desc" TEXT,
    "qty" DECIMAL(14,4),
    "rate" DECIMAL(14,4),
    "amount" DECIMAL(14,2) NOT NULL,
    "isProduct" BOOLEAN NOT NULL DEFAULT false,
    "costGroup" TEXT,
    "itemId" TEXT,

    CONSTRAINT "InventoryInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryShipment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT,
    "containers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deliveredAt" DATE,
    "isOpening" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "closedData" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryClosing" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "merchEnd" DECIMAL(14,2) NOT NULL,
    "merchEndSource" TEXT NOT NULL,
    "cogsMerch" DECIMAL(14,2) NOT NULL,
    "freightOut" DECIMAL(14,2) NOT NULL,
    "jeBookedAt" DATE,
    "jeBookedAmount" DECIMAL(14,2),
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryClosing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryItem_companyId_idx" ON "InventoryItem"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_companyId_name_key" ON "InventoryItem"("companyId", "name");

-- CreateIndex
CREATE INDEX "InventoryItemPrice_itemId_idx" ON "InventoryItemPrice"("itemId");

-- CreateIndex
CREATE INDEX "InventoryInvoice_companyId_kind_idx" ON "InventoryInvoice"("companyId", "kind");

-- CreateIndex
CREATE INDEX "InventoryInvoice_shipmentId_idx" ON "InventoryInvoice"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryInvoice_companyId_vendorName_no_key" ON "InventoryInvoice"("companyId", "vendorName", "no");

-- CreateIndex
CREATE INDEX "InventoryInvoiceVersion_invoiceId_idx" ON "InventoryInvoiceVersion"("invoiceId");

-- CreateIndex
CREATE INDEX "InventoryInvoiceLine_invoiceId_idx" ON "InventoryInvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "InventoryInvoiceLine_itemId_idx" ON "InventoryInvoiceLine"("itemId");

-- CreateIndex
CREATE INDEX "InventoryShipment_companyId_idx" ON "InventoryShipment"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryShipment_companyId_key_key" ON "InventoryShipment"("companyId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryClosing_companyId_month_key" ON "InventoryClosing"("companyId", "month");

-- AddForeignKey
ALTER TABLE "InventorySettings" ADD CONSTRAINT "InventorySettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItemPrice" ADD CONSTRAINT "InventoryItemPrice_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryInvoice" ADD CONSTRAINT "InventoryInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryInvoice" ADD CONSTRAINT "InventoryInvoice_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "InventoryShipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryInvoiceVersion" ADD CONSTRAINT "InventoryInvoiceVersion_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "InventoryInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryInvoiceLine" ADD CONSTRAINT "InventoryInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "InventoryInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryInvoiceLine" ADD CONSTRAINT "InventoryInvoiceLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryShipment" ADD CONSTRAINT "InventoryShipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryClosing" ADD CONSTRAINT "InventoryClosing_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

