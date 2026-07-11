-- CreateEnum
CREATE TYPE "OverfundingMode" AS ENUM ('NONE', 'REFUND_AT_CLOSING');

-- AlterTable
ALTER TABLE "BankProfile" ADD COLUMN     "overfundingMode" "OverfundingMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "reserveInEnvelope" BOOLEAN NOT NULL DEFAULT false;


-- Builders Capital: reserve financiada consome o comprometido (confirmado pelo Stefan
-- 10/07 com base no 77959); overfunding continua NONE (sem evidência de cheque)
UPDATE "BankProfile" SET "reserveInEnvelope" = true WHERE "name" = 'Builders Capital';
