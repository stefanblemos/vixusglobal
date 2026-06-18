-- CreateTable
CREATE TABLE "GlAccountSummary" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "beginning" DECIMAL(20,4),
    "ending" DECIMAL(20,4),

    CONSTRAINT "GlAccountSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GlAccountSummary_companyId_idx" ON "GlAccountSummary"("companyId");

-- CreateIndex
CREATE INDEX "GlAccountSummary_importId_idx" ON "GlAccountSummary"("importId");

-- AddForeignKey
ALTER TABLE "GlAccountSummary" ADD CONSTRAINT "GlAccountSummary_importId_fkey" FOREIGN KEY ("importId") REFERENCES "QboImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
