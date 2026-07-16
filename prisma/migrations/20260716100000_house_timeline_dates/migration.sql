-- Linha do tempo da ficha da casa (mock UX 1/6 aprovado): datas por passo do status,
-- alimentam o simulado × realizado. contractDate/saleDate já existiam.
ALTER TABLE "PoolHouse" ADD COLUMN "lotContractDate" DATE,
ADD COLUMN "lotPaidDate" DATE,
ADD COLUMN "buildStartDate" DATE,
ADD COLUMN "coDate" DATE;
