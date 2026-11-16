import { getInventorySettings, resolveInventoryCompany } from "@/lib/inventory/settings";
import { loadGlData, type GlData } from "@/lib/inventory/gl";

/** Contexto comum das páginas do módulo. */
export async function inventoryContext(companyParam?: string | null) {
  const ctx = await resolveInventoryCompany(companyParam);
  if (!ctx.companyId) return { ...ctx, settings: null, gl: null as GlData | null };
  const settings = await getInventorySettings(ctx.companyId);
  const gl = await loadGlData(ctx.companyId, settings);
  return { ...ctx, settings, gl };
}
