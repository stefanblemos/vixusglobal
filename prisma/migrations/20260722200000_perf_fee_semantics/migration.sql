-- profitSharePct passa a ser SEMPRE a fração do INVESTIDOR, e a UI pergunta a performance
-- da 4U. O valor existente foi digitado com a intenção "4U leva 35%" — inverte para 0,65.
-- (Só o PH-3 tinha valor; PH-4 está nulo e segue nulo.)
UPDATE "InvestmentPool"
   SET "profitSharePct" = 1 - "profitSharePct"
 WHERE "profitSharePct" IS NOT NULL
   AND "profitSharePct" < 0.5;
