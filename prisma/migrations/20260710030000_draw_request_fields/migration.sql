-- Draws: valor solicitado e data de solicitação (crédito fica em date/amount)
ALTER TABLE "PoolLoanEntry" ADD COLUMN "requestedAmount" DECIMAL(20,2);
ALTER TABLE "PoolLoanEntry" ADD COLUMN "requestDate" DATE;
