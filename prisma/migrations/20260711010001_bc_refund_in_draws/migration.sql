-- Builders Capital distribui o budget cheio nos draws (77959: draws 1.799.390 ≈ budget
-- 1.8M = comprometido − fees − reserve — confirmado pelo Stefan em 10/07)
UPDATE "BankProfile" SET "overfundingMode" = 'REFUND_IN_DRAWS' WHERE "name" = 'Builders Capital';
