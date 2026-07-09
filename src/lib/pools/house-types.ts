// Tipos de casa e labels — módulo neutro (sem "use client") para poder ser importado
// tanto por server components (aba Contractor fees) quanto por client components
// (modais do catálogo). Importar de um arquivo "use client" num server component faz o
// export virar client reference e Object.keys() devolver vazio.

export const HOUSE_TYPE_LABEL: Record<string, string> = {
  AFFORDABLE: "Affordable",
  MID_RANGE: "Mid-range",
  UPPER_MIDDLE: "Upper-middle",
  HIGH_END: "High-end",
  LUXURY: "Luxury",
  DUPLEX: "Duplex",
  TRIPLEX: "Triplex",
  MULTIFAMILY: "Multifamily",
};

export const HOUSE_TYPES = Object.keys(HOUSE_TYPE_LABEL);
