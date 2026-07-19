-- Marcos de construção (#73): catálogo de fases ponderadas + campo por casa.
CREATE TABLE IF NOT EXISTS "CatalogBuildMilestone" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "detail" TEXT,
  "weightPct" DECIMAL(6,2) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogBuildMilestone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogBuildMilestone_key_key" ON "CatalogBuildMilestone"("key");

ALTER TABLE "PoolHouse" ADD COLUMN IF NOT EXISTS "milestones" JSONB;

-- Seed dos 12 marcos padrão (só se a tabela estiver vazia) — pesos somam 100.
INSERT INTO "CatalogBuildMilestone" ("id", "key", "name", "detail", "weightPct", "sortOrder", "updatedAt")
SELECT * FROM (VALUES
  (gen_random_uuid()::text, 'site',    'Limpeza de lote / Site prep',       'terraplenagem, staking',            5.00,  0, now()),
  (gen_random_uuid()::text, 'found',   'Fundação (slab)',                   'formas, plumbing rough, concreto', 12.00,  1, now()),
  (gen_random_uuid()::text, 'block',   'Blocos / Alvenaria',                'paredes de bloco',                 12.00,  2, now()),
  (gen_random_uuid()::text, 'trusses', 'Trusses / estrutura de telhado',    'içamento e fixação',                8.00,  3, now()),
  (gen_random_uuid()::text, 'framing', 'Framing',                           'esquadrias, dry-in',                8.00,  4, now()),
  (gen_random_uuid()::text, 'mep',     'MEP (elétrica / hidráulica / AC)',  'rough-in',                         12.00,  5, now()),
  (gen_random_uuid()::text, 'drywall', 'Drywall',                           'gesso, texture',                    8.00,  6, now()),
  (gen_random_uuid()::text, 'paint',   'Pintura',                           'interna e externa',                 6.00,  7, now()),
  (gen_random_uuid()::text, 'floor',   'Piso',                              'tile / LVP',                        7.00,  8, now()),
  (gen_random_uuid()::text, 'cabinet', 'Cabinets & countertops',            'cozinha e banheiros',               8.00,  9, now()),
  (gen_random_uuid()::text, 'finish',  'Finishes',                          'trim, portas, louças, trim-out',    8.00, 10, now()),
  (gen_random_uuid()::text, 'land',    'Driveway & landscaping',            'calçada, grama, CO',                6.00, 11, now())
) AS v
WHERE NOT EXISTS (SELECT 1 FROM "CatalogBuildMilestone");
