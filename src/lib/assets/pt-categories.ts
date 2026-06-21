// Classes de ativo de Portugal → taxa anual de depreciação (quotas constantes).
// Taxas máximas do Decreto Regulamentar 25/2009 (tabelas anexas). O usuário pode
// ajustar a taxa por ativo. Edifícios separam a parcela de TERRENO (não deprecia).

export interface PtAssetCategory {
  key: string;
  label: string;
  ratePct: number; // taxa anual (%)
  isBuilding?: boolean; // pede a parcela de terreno (não depreciável)
  hint?: string;
}

export const PT_ASSET_CATEGORIES: PtAssetCategory[] = [
  {
    key: "BUILDING_COMM",
    label: "Edifício comercial / administrativo",
    ratePct: 2,
    isBuilding: true,
    hint: "50 anos — separe o valor do terreno",
  },
  {
    key: "BUILDING_IND",
    label: "Edifício industrial",
    ratePct: 5,
    isBuilding: true,
    hint: "20 anos — separe o valor do terreno",
  },
  {
    key: "BUILDING_RES",
    label: "Edifício de habitação / arrendamento",
    ratePct: 2,
    isBuilding: true,
    hint: "50 anos — separe o valor do terreno",
  },
  { key: "OTHER_CONSTRUCTION", label: "Outras construções e instalações", ratePct: 5 },
  { key: "EQUIPMENT", label: "Equipamento básico (máquinas)", ratePct: 12.5, hint: "8 anos" },
  { key: "FURNITURE", label: "Equipamento administrativo / mobiliário", ratePct: 12.5, hint: "8 anos" },
  { key: "COMPUTER", label: "Equipamento informático", ratePct: 33.33, hint: "3 anos" },
  { key: "SOFTWARE", label: "Software / programas de computador", ratePct: 33.33, hint: "3 anos" },
  { key: "VEHICLE_LIGHT", label: "Viatura ligeira", ratePct: 25, hint: "4 anos" },
  { key: "VEHICLE_HEAVY", label: "Viatura pesada", ratePct: 20, hint: "5 anos" },
  { key: "OTHER", label: "Outro (defina a taxa)", ratePct: 10 },
];

export const ptCategoryByKey = (key: string): PtAssetCategory =>
  PT_ASSET_CATEGORIES.find((c) => c.key === key) ??
  PT_ASSET_CATEGORIES[PT_ASSET_CATEGORIES.length - 1];
