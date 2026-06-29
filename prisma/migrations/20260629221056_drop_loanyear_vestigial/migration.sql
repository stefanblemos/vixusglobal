-- Remove as colunas VESTIGIAIS de LoanYear (principalAdded/principalRepaid/interestAccrued).
-- O principal é fonte única em LoanTransaction; estas nunca foram gravadas pela UI (sempre 0).
-- GUARDA anti-perda: se em PRODUÇÃO alguma linha tiver valor <> 0, a migração ABORTA (RAISE) e nada
-- é removido — para investigar o dado antes, em vez de destruí-lo silenciosamente.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "LoanYear"
   WHERE "principalAdded" <> 0 OR "principalRepaid" <> 0 OR "interestAccrued" <> 0;
  IF n > 0 THEN
    RAISE EXCEPTION 'Abortado: % linha(s) de LoanYear com principal/accrued <> 0 — investigar antes de remover as colunas', n;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "LoanYear" DROP COLUMN "interestAccrued",
DROP COLUMN "principalAdded",
DROP COLUMN "principalRepaid";
