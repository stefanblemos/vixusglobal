-- Closing do loan liberado com %% dos permits emitidos (default 80)
ALTER TABLE "BankProfile" ADD COLUMN "closingPermitPct" DECIMAL(5,2) NOT NULL DEFAULT 80;
