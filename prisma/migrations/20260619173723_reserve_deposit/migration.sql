-- CreateTable
CREATE TABLE "ReserveDeposit" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "depositedAt" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReserveDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReserveDeposit_companyId_year_idx" ON "ReserveDeposit"("companyId", "year");

-- AddForeignKey
ALTER TABLE "ReserveDeposit" ADD CONSTRAINT "ReserveDeposit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
