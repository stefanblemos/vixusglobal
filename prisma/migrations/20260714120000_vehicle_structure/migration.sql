-- Estrutura do veículo (Vixus-managed vs entidade do cliente) — Vixus = Development Manager
CREATE TYPE "SimVehicleStructure" AS ENUM ('VIXUS_MANAGED', 'CLIENT_ENTITY');
ALTER TABLE "PoolSimulation" ADD COLUMN "vehicleStructure" "SimVehicleStructure" NOT NULL DEFAULT 'VIXUS_MANAGED';
ALTER TABLE "PoolSimulation" ADD COLUMN "clientEntityName" TEXT;
