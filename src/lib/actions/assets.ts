"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { categoryByKey } from "@/lib/assets/categories";
import { ptCategoryByKey } from "@/lib/assets/pt-categories";

export type AssetFormState = { error?: string } | undefined;

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export async function createAsset(
  _prev: AssetFormState,
  formData: FormData,
): Promise<AssetFormState> {
  const companyId = String(formData.get("companyId") ?? "");
  const regime = String(formData.get("regime") ?? "US") === "PT" ? "PT" : "US";
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "OTHER");
  const acquisitionDate = String(formData.get("acquisitionDate") ?? "").trim();
  const cost = num(formData.get("cost"));

  if (!companyId) return { error: "Select a company." };
  if (!name) return { error: "Name is required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(acquisitionDate)) return { error: "Use a valid acquisition date." };
  if (cost <= 0) return { error: "Cost must be greater than zero." };

  if (regime === "PT") {
    // Portugal — quotas constantes (DR 25/2009). Taxa anual + parcela de terreno.
    const cat = ptCategoryByKey(category);
    const rateRaw = String(formData.get("ratePct") ?? "").trim();
    const ratePct = rateRaw ? Number(rateRaw) : cat.ratePct;
    if (!Number.isFinite(ratePct) || ratePct <= 0) return { error: "Set a valid annual rate (%)." };
    const landValue = Math.max(0, Math.min(num(formData.get("landValue")), cost));
    await prisma.fixedAsset.create({
      data: {
        companyId,
        regime: "PT",
        name,
        category,
        acquisitionDate: new Date(`${acquisitionDate}T00:00:00Z`),
        cost,
        recoveryYears: Math.round((100 / ratePct) * 10) / 10, // vida ≈ 100/taxa
        method: "SL_PT",
        ratePct,
        landValue,
        notes: String(formData.get("notes") ?? "").trim() || null,
      },
    });
    revalidatePath("/assets");
    return undefined;
  }

  const cat = categoryByKey(category);
  // Vida/método: usa o override do formulário se vier, senão o padrão da categoria.
  const recoveryRaw = String(formData.get("recoveryYears") ?? "").trim();
  const recoveryYears = recoveryRaw ? Number(recoveryRaw) : cat.recoveryYears;
  const method = cat.method;

  const section179 = num(formData.get("section179"));
  const bonusPct = num(formData.get("bonusPct"));

  await prisma.fixedAsset.create({
    data: {
      companyId,
      regime: "US",
      name,
      category,
      acquisitionDate: new Date(`${acquisitionDate}T00:00:00Z`),
      cost,
      recoveryYears,
      method,
      section179: Math.min(section179, cost),
      bonusPct: Math.max(0, Math.min(bonusPct, 100)),
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });

  revalidatePath("/assets");
  return undefined;
}

// Cadastra em lote os ativos confirmados na revisão (US/MACRS). Form action (FormData) — padrão
// robusto; a detecção em si roda no server component da página (via ?detect=).
export async function createDetectedAssets(formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "");
  const assetsJson = String(formData.get("assets") ?? "[]");
  if (!companyId) return;
  let list: { name: string; cost: number; acquisitionDate: string; category: string; recoveryYears: number; disposalDate?: string; fullyDepreciatedYear?: number | null }[];
  try {
    list = JSON.parse(assetsJson);
  } catch {
    return;
  }
  // Idempotente: ignora ativos que já existem (mesma empresa + nome + data + custo). Assim, um
  // duplo-clique ou re-submit não cria duplicados.
  const key = (name: string, isoDate: string, cost: number) =>
    `${name.toLowerCase().trim()}|${isoDate}|${Math.round(cost * 100)}`;
  const existing = await prisma.fixedAsset.findMany({
    where: { companyId },
    select: { name: true, acquisitionDate: true, cost: true },
  });
  const seen = new Set(existing.map((e) => key(e.name, e.acquisitionDate.toISOString().slice(0, 10), Number(e.cost))));

  const data = list
    .filter((a) => a.name && Number(a.cost) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(a.acquisitionDate))
    .filter((a) => {
      const k = key(a.name, a.acquisitionDate, Number(a.cost));
      if (seen.has(k)) return false;
      seen.add(k); // evita duplicado dentro do próprio lote também
      return true;
    })
    .map((a) => {
      const cat = categoryByKey(a.category);
      return {
        companyId,
        regime: "US",
        name: String(a.name).slice(0, 200),
        category: a.category,
        acquisitionDate: new Date(`${a.acquisitionDate}T00:00:00Z`),
        cost: Number(a.cost),
        recoveryYears: Number(a.recoveryYears) || cat.recoveryYears,
        method: cat.method,
        section179: 0,
        bonusPct: 0,
        disposalDate:
          a.disposalDate && /^\d{4}-\d{2}-\d{2}$/.test(a.disposalDate)
            ? new Date(`${a.disposalDate}T00:00:00Z`)
            : null,
        fullyDepreciatedYear:
          a.fullyDepreciatedYear && /^\d{4}$/.test(String(a.fullyDepreciatedYear)) ? Number(a.fullyDepreciatedYear) : null,
        notes: "from-qbo",
      };
    });
  if (data.length) await prisma.fixedAsset.createMany({ data });
  revalidatePath("/assets");
}

// Remove ativos duplicados (mesma empresa + nome + data + custo), mantendo o mais antigo.
export async function dedupeAssets(formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "") || undefined;
  const assets = await prisma.fixedAsset.findMany({
    where: companyId ? { companyId } : {},
    select: { id: true, companyId: true, name: true, acquisitionDate: true, cost: true, createdAt: true },
    orderBy: { createdAt: "asc" }, // o 1º de cada grupo é mantido
  });
  const seen = new Set<string>();
  const toDelete: string[] = [];
  for (const a of assets) {
    const k = `${a.companyId}|${a.name.toLowerCase().trim()}|${a.acquisitionDate.toISOString().slice(0, 10)}|${Math.round(Number(a.cost) * 100)}`;
    if (seen.has(k)) toDelete.push(a.id);
    else seen.add(k);
  }
  if (toDelete.length) await prisma.fixedAsset.deleteMany({ where: { id: { in: toDelete } } });
  revalidatePath("/assets");
}

// Renomeia um ativo já cadastrado (nomes do QBO às vezes não ajudam).
export async function renameAsset(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (id && name) await prisma.fixedAsset.update({ where: { id }, data: { name: name.slice(0, 200) } });
  revalidatePath("/assets");
}

// Confirma (ou limpa) que o contador depreciou o ativo TOTALMENTE no livro até um ano. Setado →
// o motor para de projetar depreciação futura desse ativo. Limpar = volta à MACRS normal.
export async function setFullyDepreciated(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const raw = String(formData.get("fullyDepreciatedYear") ?? "").trim();
  const year = /^\d{4}$/.test(raw) ? Number(raw) : null;
  await prisma.fixedAsset.update({ where: { id }, data: { fullyDepreciatedYear: year } });
  revalidatePath("/assets");
}

// Confirma (ou limpa) a venda/baixa do ativo num ano. Setado → o motor toma metade da cota no ano
// da baixa (half-year) e para de depreciar depois. Persiste como disposalDate (meio do ano).
export async function setDisposal(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const raw = String(formData.get("disposalYear") ?? "").trim();
  const year = /^\d{4}$/.test(raw) ? Number(raw) : null;
  await prisma.fixedAsset.update({
    where: { id },
    data: { disposalDate: year ? new Date(`${year}-07-01T00:00:00Z`) : null },
  });
  revalidatePath("/assets");
}

// Registra (ou limpa) a depreciação REAL lançada no livro de um ativo num ano. Vazio = remove o
// registro daquele ano. É a fonte oficial do "valor depreciado" por ativo, para comparar com a MACRS.
export async function setAssetYearDepreciation(formData: FormData): Promise<void> {
  const assetId = String(formData.get("assetId") ?? "");
  const year = Math.trunc(num(formData.get("year")));
  if (!assetId || !year) return;
  const raw = String(formData.get("amount") ?? "").trim();
  if (raw === "") {
    await prisma.assetYearDepreciation.deleteMany({ where: { assetId, year } });
  } else {
    const amount = num(formData.get("amount"));
    await prisma.assetYearDepreciation.upsert({
      where: { assetId_year: { assetId, year } },
      create: { assetId, year, amount },
      update: { amount },
    });
  }
  revalidatePath("/assets");
}

// Distribui um saldo (ex.: IR declarado − já registrado) entre vários ativos de um ano, de uma vez.
// O cálculo proporcional é feito no cliente (proporcional à MACRS); aqui só gravamos os valores.
export async function distributeYearDepreciation(formData: FormData): Promise<void> {
  const year = Math.trunc(num(formData.get("year")));
  if (!year) return;
  let allocs: { assetId: string; amount: number }[];
  try {
    allocs = JSON.parse(String(formData.get("allocations") ?? "[]"));
  } catch {
    return;
  }
  for (const a of allocs) {
    if (!a.assetId || !Number.isFinite(a.amount) || a.amount <= 0) continue;
    const amount = Math.round(a.amount * 100) / 100;
    await prisma.assetYearDepreciation.upsert({
      where: { assetId_year: { assetId: a.assetId, year } },
      create: { assetId: a.assetId, year, amount },
      update: { amount },
    });
  }
  revalidatePath("/assets");
}

// Reverte a "cadeia de eventos" de um ativo: tira a baixa, tira o "totalmente depreciado" e apaga
// TODOS os valores de depreciação por ano registrados. Volta ao estado limpo (MACRS pura); a base
// (nome, custo, data, categoria) fica. Para corrigir um cadastro bagunçado e refazer do zero.
export async function revertAssetEntries(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.$transaction([
    prisma.assetYearDepreciation.deleteMany({ where: { assetId: id } }),
    prisma.fixedAsset.update({ where: { id }, data: { disposalDate: null, fullyDepreciatedYear: null } }),
  ]);
  revalidatePath("/assets");
}

// Mescla dois ativos em um (vieram separados no livro mas são um só). Soma o custo (valor original)
// e §179, e soma os valores por ano. Mantém o "target" (com nome/data/categoria dele) e deleta o
// "source". BLOQUEIA se forem incompatíveis: empresa, data de aquisição, método e vida têm que ser
// iguais (senão a depreciação não combina).
export async function mergeAssets(formData: FormData): Promise<void> {
  const targetId = String(formData.get("targetId") ?? "");
  const sourceId = String(formData.get("sourceId") ?? "");
  if (!targetId || !sourceId || targetId === sourceId) return;
  const [target, source] = await Promise.all([
    prisma.fixedAsset.findUnique({ where: { id: targetId } }),
    prisma.fixedAsset.findUnique({ where: { id: sourceId } }),
  ]);
  if (!target || !source) return;
  const compatible =
    target.companyId === source.companyId &&
    target.acquisitionDate.getTime() === source.acquisitionDate.getTime() &&
    target.method === source.method &&
    Number(target.recoveryYears) === Number(source.recoveryYears);
  if (!compatible) return; // bloqueia

  const srcYears = await prisma.assetYearDepreciation.findMany({ where: { assetId: sourceId } });
  await prisma.$transaction(async (tx) => {
    for (const sy of srcYears) {
      const ex = await tx.assetYearDepreciation.findUnique({
        where: { assetId_year: { assetId: targetId, year: sy.year } },
      });
      const amount = Math.round(((ex ? Number(ex.amount) : 0) + Number(sy.amount)) * 100) / 100;
      await tx.assetYearDepreciation.upsert({
        where: { assetId_year: { assetId: targetId, year: sy.year } },
        create: { assetId: targetId, year: sy.year, amount },
        update: { amount },
      });
    }
    await tx.fixedAsset.update({
      where: { id: targetId },
      data: {
        cost: Number(target.cost) + Number(source.cost),
        section179: Number(target.section179) + Number(source.section179),
      },
    });
    await tx.fixedAsset.delete({ where: { id: sourceId } }); // cascade apaga os year-deps do source
  });
  revalidatePath("/assets");
}

export async function deleteAsset(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.fixedAsset.delete({ where: { id } });
  revalidatePath("/assets");
}
