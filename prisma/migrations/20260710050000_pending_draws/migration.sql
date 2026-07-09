-- Draw pendente (solicitado, aguardando resposta do banco)
ALTER TABLE "PoolLoanEntry" ADD COLUMN "pending" BOOLEAN NOT NULL DEFAULT false;
