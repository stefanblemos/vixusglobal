-- Renumera draws por LEVA: um pedido em conjunto (várias casas no mesmo dia, mesmo loan)
-- deve compartilhar o número do draw. O "draw em lote" numerava por casa (#1..#N) — corrige.
-- Só toca loans onde ALGUMA requestDate tem >1 draw (o sintoma do lote); draws sem requestDate
-- (legado) e loans já corretos ficam intactos. Idempotente (rodar de novo dá o mesmo resultado).
WITH affected AS (
  SELECT "loanId"
  FROM "PoolLoanEntry"
  WHERE "type" = 'DRAW' AND "requestDate" IS NOT NULL
  GROUP BY "loanId", "requestDate"
  HAVING COUNT(*) > 1
),
ranked AS (
  SELECT "id",
         DENSE_RANK() OVER (PARTITION BY "loanId" ORDER BY "requestDate") AS bn
  FROM "PoolLoanEntry"
  WHERE "type" = 'DRAW' AND "requestDate" IS NOT NULL
    AND "loanId" IN (SELECT DISTINCT "loanId" FROM affected)
)
UPDATE "PoolLoanEntry" e
SET "drawNumber" = r.bn
FROM ranked r
WHERE e."id" = r."id" AND e."drawNumber" IS DISTINCT FROM r.bn;
