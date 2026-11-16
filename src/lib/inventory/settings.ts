import { prisma } from "@/lib/db";

/** Configuração do módulo por empresa (cria com os defaults na 1ª vez). */
export async function getInventorySettings(companyId: string) {
  const s = await prisma.inventorySettings.findUnique({ where: { companyId } });
  if (s) return s;
  return prisma.inventorySettings.create({ data: { companyId } });
}

/** Empresa do módulo: a do param, senão a única com settings, senão null. */
export async function resolveInventoryCompany(param?: string | null) {
  const companies = await prisma.company.findMany({ where: { status: "ACTIVE" }, select: { id: true, legalName: true }, orderBy: { legalName: "asc" } });
  let id = param && companies.some((c) => c.id === param) ? param : null;
  if (!id) {
    const withSettings = await prisma.inventorySettings.findMany({ select: { companyId: true } });
    if (withSettings.length === 1) id = withSettings[0].companyId;
    else id = companies.find((c) => /buildpro/i.test(c.legalName))?.id ?? null;
  }
  return { companies, companyId: id, company: companies.find((c) => c.id === id) ?? null };
}

/** preço = custo ÷ (1 − margem) — margem SOBRE O PREÇO (regra do Stefan, 16/11). */
export const priceForMargin = (cost: number, marginPct: number) => (marginPct >= 100 ? cost : cost / (1 - marginPct / 100));
export const marginOf = (cost: number, price: number) => (price > 0 ? 1 - cost / price : null);
