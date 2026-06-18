-- CreateTable
CREATE TABLE "CompanyYearNote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyYearNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyYearNote_companyId_year_key" ON "CompanyYearNote"("companyId", "year");

-- AddForeignKey
ALTER TABLE "CompanyYearNote" ADD CONSTRAINT "CompanyYearNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
