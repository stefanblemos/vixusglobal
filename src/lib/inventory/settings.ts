import { prisma } from "@/lib/db";
import type { InventorySettings, InventoryVendor } from "@prisma/client";

/** Settings + fornecedores ativos, com os campos derivados que o resto do módulo usa. */
export type InventorySettingsFull = InventorySettings & {
  vendors: InventoryVendor[];
  /** chaves de casamento com o rawName do GL (1ª palavra do nome + apelidos), minúsculas */
  vendorKeys: string[];
  /** fornecedor padrão (1º ativo) — usado quando a invoice não diz de quem é */
  vendorName: string;
  /** união dos termos de todos os fornecedores ativos */
  closeHintTerms: string[];
};

export const DEFAULT_VENDOR = "Archway Trade LLC";

export function vendorKeysOf(vendors: { name: string; aliases: string[] }[]): string[] {
  const keys = vendors.flatMap((v) => [v.name.split(" ")[0], ...v.aliases]).map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 3);
  return [...new Set(keys)];
}

/** Configuração do módulo por empresa (cria com os defaults + fornecedor padrão na 1ª vez). */
export async function getInventorySettings(companyId: string): Promise<InventorySettingsFull> {
  let s = await prisma.inventorySettings.findUnique({ where: { companyId } });
  if (!s) s = await prisma.inventorySettings.create({ data: { companyId } });
  let vendors = await prisma.inventoryVendor.findMany({ where: { companyId, active: true }, orderBy: { createdAt: "asc" } });
  if (!vendors.length && !(await prisma.inventoryVendor.count({ where: { companyId } }))) {
    vendors = [await prisma.inventoryVendor.create({ data: { companyId, name: DEFAULT_VENDOR } })];
  }
  return {
    ...s,
    vendors,
    vendorKeys: vendorKeysOf(vendors),
    vendorName: vendors[0]?.name ?? DEFAULT_VENDOR,
    closeHintTerms: [...new Set(vendors.flatMap((v) => v.closeHintTerms.map((t) => t.toLowerCase())))],
  };
}

/** O rawName do GL pertence a algum fornecedor cadastrado? Devolve o nome do fornecedor. */
export function vendorOfRawName(rawName: string | null | undefined, vendors: { name: string; aliases: string[] }[]): string | null {
  const r = (rawName ?? "").toLowerCase();
  if (!r) return null;
  for (const v of vendors) {
    const keys = vendorKeysOf([v]);
    if (keys.some((k) => r.includes(k))) return v.name;
  }
  return null;
}

/** Fornecedor escolhido no form (nome exato de um ativo), senão o padrão. */
export function pickVendor(s: InventorySettingsFull, chosen: string | null | undefined): string {
  const c = (chosen ?? "").trim();
  return s.vendors.find((v) => v.name === c)?.name ?? s.vendorName;
}

/** Prazo de aviso (mercadoria sem frete) do fornecedor da invoice. */
export const waitDaysFor = (s: InventorySettingsFull, vendorName: string) => s.vendors.find((v) => v.name === vendorName)?.waitDays ?? s.vendors[0]?.waitDays ?? 30;

/** Mês "YYYY-MM" é só leitura? (livros fechados até booksClosedThrough; sem config: anos anteriores ao corrente) */
export function isClosedBooks(s: { booksClosedThrough: string | null }, month: string): boolean {
  const through = s.booksClosedThrough ?? `${new Date().getUTCFullYear() - 1}-12`;
  return month <= through;
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
