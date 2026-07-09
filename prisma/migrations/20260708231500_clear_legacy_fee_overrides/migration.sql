-- Data fix: o contractor fee agora vem do TIPO de casa (HouseTypeFee). Limpa os overrides
-- herdados do seed antigo (deltas do mockup: 7k/8k/9k/15k/20k) preservando valores realmente
-- customizados pelo usuário; registra affordable = 25000 (regra definida pelo Stefan) se
-- ainda não preenchido; Arpoador é affordable.

UPDATE "CatalogModel" SET "contractorFee" = NULL
WHERE "contractorFee" IN (7000, 8000, 9000, 15000, 20000);

UPDATE "HouseTypeFee" SET "fee" = 25000
WHERE "type" = 'AFFORDABLE' AND "fee" = 0;

UPDATE "CatalogModel" SET "houseType" = 'AFFORDABLE' WHERE "name" = 'Arpoador';
