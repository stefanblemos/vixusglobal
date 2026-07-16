-- Cronograma previsto × realizado (mock aprovado 16/07): datas reais de permit na casa +
-- baseline congelado da simulação no pool (os deltas do report mensal não mudam retroativamente)
ALTER TABLE "PoolHouse" ADD COLUMN "permitAppliedDate" DATE,
ADD COLUMN "permitIssuedDate" DATE;

ALTER TABLE "InvestmentPool" ADD COLUMN "scheduleBaseline" JSONB;
