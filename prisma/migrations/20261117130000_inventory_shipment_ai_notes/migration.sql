-- Inventory: nota do Claude sobre os memos do embarque (custos cobrados × "NOT included")
ALTER TABLE "InventoryShipment" ADD COLUMN "aiStatus" TEXT, ADD COLUMN "aiNote" TEXT, ADD COLUMN "aiPending" TEXT[] DEFAULT ARRAY[]::TEXT[], ADD COLUMN "aiAt" TIMESTAMP(3), ADD COLUMN "aiHash" TEXT;
