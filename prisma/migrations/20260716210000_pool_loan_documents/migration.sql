-- Documentos do financiamento por loan do pool (mock aprovado 16/07): o documento é a
-- fonte dos campos (condições, prazos, valores liberados) — extração AI + proposta revisável.
CREATE TYPE "LoanDocKind" AS ENUM ('LOI', 'AGREEMENT', 'NOTE', 'SETTLEMENT', 'DRAW', 'STATEMENT', 'OTHER');

CREATE TABLE "PoolLoanDocument" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "kind" "LoanDocKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "pdf" BYTEA NOT NULL,
    "pdfSize" INTEGER NOT NULL,
    "summary" TEXT,
    "extracted" JSONB,
    "proposal" JSONB,
    "appliedSummary" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoolLoanDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PoolLoanDocument_loanId_idx" ON "PoolLoanDocument"("loanId");

ALTER TABLE "PoolLoanDocument" ADD CONSTRAINT "PoolLoanDocument_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "PoolLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
