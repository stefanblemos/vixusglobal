// API pública do simulador standalone (Vixus → plataforma 4U)
export { simulate } from "./simulator";
export type { SimInput, SimResult, SimUnitInput, SimUnitResult, SimBank, SimEvent } from "./simulator";
export {
  buildSimInputCore,
  comboKey,
  countOverrides,
} from "./build-input-core";
export type {
  CatalogData,
  CatalogScenarioData,
  CatalogComboData,
  CatalogBankData,
  CatalogVehicleCostData,
  SimFields,
  SimOverrides,
  UnitRef,
  PromoteTierInput,
} from "./build-input-core";
export { phasesOf, daysToMonths } from "./phases";
export { benchmarkOf } from "./benchmark";
export { assembleReportData } from "./report-data-core";
export type { ReportData, ReportModelInfo, ReportSimMeta, ScenarioKpis } from "./report-data-core";
export { buildReportDocx } from "./report-docx";
export type { ReportLang } from "./report-docx";
// Prosa da IA (opcional — precisa de @anthropic-ai/sdk + zod + ANTHROPIC_API_KEY):
// importe direto de "./report-ai-core" para não carregar as deps opcionais à toa.
