-- Absorção de mercado manual por local (casas novas vendidas/ano) — fonte do otimizador
-- para locais fora do feed ATTOM. Onde há ATTOM, o feed prevalece no código.
ALTER TABLE "CatalogLocation" ADD COLUMN IF NOT EXISTS "absorptionPerYear" INTEGER;
