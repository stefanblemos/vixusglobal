-- CreateEnum
CREATE TYPE "BankLineStatus" AS ENUM ('UNREVIEWED', 'MATCHED', 'FLAGGED', 'IGNORED');

-- AlterTable
ALTER TABLE "BankStatementLine" ADD COLUMN     "note" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "status" "BankLineStatus" NOT NULL DEFAULT 'UNREVIEWED';
