-- Waiver do custo de abertura: custos do veículo valem independentemente da estrutura;
-- se o cliente já tem entidade e não abrirá nova, a isenção é marcada na simulação.
ALTER TABLE "PoolSimulation" ADD COLUMN "waiveFormationCost" BOOLEAN NOT NULL DEFAULT false;
