-- AlterTable
ALTER TABLE "BankStatementLine" ADD COLUMN     "matchedTxnIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
