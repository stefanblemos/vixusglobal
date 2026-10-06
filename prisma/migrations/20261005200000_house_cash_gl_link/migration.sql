-- Conferência com o GL (etapa 3): lançamento do extrato da casa pode apontar p/ a transação
-- do QuickBooks que o originou (não trazer duas vezes; aberturas ganham data real).
ALTER TABLE "HouseCashEntry" ADD COLUMN IF NOT EXISTS "glTxnId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "HouseCashEntry_glTxnId_key" ON "HouseCashEntry"("glTxnId");
