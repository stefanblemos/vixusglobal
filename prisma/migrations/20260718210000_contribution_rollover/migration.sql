-- Extrato "conta bancária" do investidor (regra da carteira aprovada 19/07/2026):
-- rolagem direta (distribuição → aporte) + override de dinheiro novo
ALTER TABLE "PoolContribution" ADD COLUMN IF NOT EXISTS "rolloverOfDistributionId" TEXT;
ALTER TABLE "PoolContribution" ADD COLUMN IF NOT EXISTS "newMoneyOverride" BOOLEAN NOT NULL DEFAULT false;
