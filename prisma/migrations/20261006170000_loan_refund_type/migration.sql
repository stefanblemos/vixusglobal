-- Reembolso do banco (06/10/2026): saldo do loan pago a maior devolvido ao pool (cheque).
ALTER TYPE "PoolLoanEntryType" ADD VALUE IF NOT EXISTS 'REFUND';
