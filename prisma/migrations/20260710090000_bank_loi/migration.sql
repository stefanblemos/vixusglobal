-- CreateTable
CREATE TABLE "BankLoi" (
    "id" TEXT NOT NULL,
    "bankProfileId" TEXT,
    "fileName" TEXT NOT NULL,
    "pdf" BYTEA,
    "pdfSize" INTEGER,
    "loiNumber" TEXT,
    "loiDate" DATE,
    "propertyAddress" TEXT,
    "extracted" JSONB NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankLoi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankLoi_bankProfileId_idx" ON "BankLoi"("bankProfileId");

-- AddForeignKey
ALTER TABLE "BankLoi" ADD CONSTRAINT "BankLoi_bankProfileId_fkey" FOREIGN KEY ("bankProfileId") REFERENCES "BankProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

