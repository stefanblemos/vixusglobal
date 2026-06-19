// Tipos de ativo → classe MACRS (vida de recuperação e método). EUA, GDS.
// Regras gerais (Pub. 946); o usuário pode ajustar a vida por ativo.

export interface AssetCategory {
  key: string;
  label: string;
  recoveryYears: number; // 5, 7, 15, 27.5, 39
  method: "MACRS" | "SL_MM"; // SL_MM = straight-line mid-month (imóveis)
  hint?: string;
}

export const ASSET_CATEGORIES: AssetCategory[] = [
  { key: "AUTO", label: "Vehicle / car", recoveryYears: 5, method: "MACRS", hint: "Autos & light trucks (luxury-auto caps may apply)" },
  { key: "COMPUTER", label: "Computer / electronics", recoveryYears: 5, method: "MACRS" },
  { key: "EQUIPMENT", label: "Machinery / equipment", recoveryYears: 7, method: "MACRS" },
  { key: "FURNITURE", label: "Furniture & fixtures", recoveryYears: 7, method: "MACRS" },
  { key: "LAND_IMP", label: "Land improvements", recoveryYears: 15, method: "MACRS", hint: "Fences, paving, landscaping" },
  { key: "RESIDENTIAL_RE", label: "Residential rental property", recoveryYears: 27.5, method: "SL_MM" },
  { key: "COMMERCIAL_RE", label: "Commercial real estate", recoveryYears: 39, method: "SL_MM" },
  { key: "OTHER", label: "Other (set the life)", recoveryYears: 7, method: "MACRS" },
];

export const categoryByKey = (key: string): AssetCategory =>
  ASSET_CATEGORIES.find((c) => c.key === key) ?? ASSET_CATEGORIES[ASSET_CATEGORIES.length - 1];
