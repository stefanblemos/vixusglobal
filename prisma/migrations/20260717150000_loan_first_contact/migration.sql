-- 1º contato com o banco: abre o estágio de documentação do ciclo do loan no Cronograma
ALTER TABLE "PoolLoan" ADD COLUMN IF NOT EXISTS "firstContactDate" DATE;
