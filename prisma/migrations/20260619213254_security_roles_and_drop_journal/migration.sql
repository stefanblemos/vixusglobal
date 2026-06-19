/*
  Warnings:

  - You are about to drop the `JournalEntry` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `JournalLine` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `LedgerAccount` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "JournalEntry" DROP CONSTRAINT "JournalEntry_companyId_fkey";

-- DropForeignKey
ALTER TABLE "JournalLine" DROP CONSTRAINT "JournalLine_accountId_fkey";

-- DropForeignKey
ALTER TABLE "JournalLine" DROP CONSTRAINT "JournalLine_journalEntryId_fkey";

-- DropForeignKey
ALTER TABLE "LedgerAccount" DROP CONSTRAINT "LedgerAccount_companyId_fkey";

-- DropForeignKey
ALTER TABLE "LedgerAccount" DROP CONSTRAINT "LedgerAccount_parentId_fkey";

-- DropTable
DROP TABLE "JournalEntry";

-- DropTable
DROP TABLE "JournalLine";

-- DropTable
DROP TABLE "LedgerAccount";

-- DropEnum
DROP TYPE "AccountType";

-- DropEnum
DROP TYPE "JournalSource";
