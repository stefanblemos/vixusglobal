"use server";

// Marcos de construção (#73): catálogo editável + marcação por casa + requisição de draw
// (por casa e em lote/pool). % de obra = soma dos pesos marcados; draw esperado = % × loan.
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logInvestmentAudit } from "@/lib/audit";
import { estimatedDrawable, milestonePct, type HouseMilestones, type MilestoneCatalog } from "@/lib/pools/milestones";

export type MilestoneFormState = { error?: string; ok?: boolean } | undefined;

// catálogo de marcos com weightPct já como number (Prisma devolve Decimal)
async function loadMilestoneCatalog(): Promise<MilestoneCatalog[]> {
  const rows = await prisma.catalogBuildMilestone.findMany({ orderBy: { sortOrder: "asc" } });
  return rows.map((r) => ({ key: r.key, name: r.name, detail: r.detail, weightPct: Number(r.weightPct), sortOrder: r.sortOrder }));
}

// ── Catálogo (Catalog) ───────────────────────────────────────
// Salva a lista inteira (pesos precisam somar 100). Recebe JSON em "rows".
export async function saveMilestoneCatalog(_prev: MilestoneFormState, formData: FormData): Promise<MilestoneFormState> {
  let rows: Array<{ key: string; name: string; detail?: string; weightPct: number; sortOrder: number }>;
  try {
    rows = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { error: "Dados inválidos." };
  }
  if (!rows.length) return { error: "Adicione ao menos uma fase." };
  for (const r of rows) {
    if (!r.key?.trim() || !r.name?.trim()) return { error: "Cada fase precisa de chave e nome." };
    if (!Number.isFinite(r.weightPct) || r.weightPct < 0) return { error: `Peso inválido em "${r.name}".` };
  }
  const keys = rows.map((r) => r.key.trim());
  if (new Set(keys).size !== keys.length) return { error: "Chaves de fase duplicadas." };
  const sum = Math.round(rows.reduce((s, r) => s + r.weightPct, 0) * 100) / 100;
  if (sum !== 100) return { error: `Os pesos somam ${sum}% — precisam somar 100%.` };

  // substitui o catálogo (deleta as fases removidas; upsert do resto)
  const existing = await prisma.catalogBuildMilestone.findMany({ select: { key: true } });
  const keepKeys = new Set(keys);
  const toDelete = existing.filter((e) => !keepKeys.has(e.key)).map((e) => e.key);
  await prisma.$transaction([
    ...(toDelete.length ? [prisma.catalogBuildMilestone.deleteMany({ where: { key: { in: toDelete } } })] : []),
    ...rows.map((r, i) =>
      prisma.catalogBuildMilestone.upsert({
        where: { key: r.key.trim() },
        create: { key: r.key.trim(), name: r.name.trim(), detail: r.detail?.trim() || null, weightPct: r.weightPct, sortOrder: i },
        update: { name: r.name.trim(), detail: r.detail?.trim() || null, weightPct: r.weightPct, sortOrder: i },
      }),
    ),
  ]);
  revalidatePath("/pools/catalog");
  return { ok: true };
}

// ── Marcação por casa ────────────────────────────────────────
export async function toggleHouseMilestone(formData: FormData): Promise<void> {
  const houseId = String(formData.get("houseId") ?? "").trim();
  const key = String(formData.get("key") ?? "").trim();
  const done = formData.get("done") === "true";
  const dateRaw = String(formData.get("date") ?? "").trim();
  if (!houseId || !key) return;
  const house = await prisma.poolHouse.findUnique({
    where: { id: houseId },
    select: { poolId: true, address: true, milestones: true },
  });
  if (!house) return;

  const cat = await prisma.catalogBuildMilestone.findUnique({ where: { key }, select: { name: true } });
  // merge ATÔMICO no jsonb (|| adiciona, - remove) — evita corrida entre toggles simultâneos
  if (done) {
    const date = dateRaw || new Date().toISOString().slice(0, 10);
    await prisma.$executeRaw`UPDATE "PoolHouse" SET "milestones" = COALESCE("milestones", '{}'::jsonb) || jsonb_build_object(${key}::text, ${date}::text) WHERE "id" = ${houseId}`;
  } else {
    await prisma.$executeRaw`UPDATE "PoolHouse" SET "milestones" = COALESCE("milestones", '{}'::jsonb) - ${key}::text WHERE "id" = ${houseId}`;
  }
  await logInvestmentAudit({
    poolId: house.poolId,
    entity: "HOUSE",
    entityId: houseId,
    action: "UPDATE",
    summary: `Marco "${cat?.name ?? key}" ${done ? "concluído" : "desmarcado"} · ${house.address.split(",")[0]}`,
  });
  revalidatePath(`/pools/${house.poolId}`);
}

// ── Requisição de draw (single + lote/pool) ──────────────────
async function drawableForHouse(
  houseId: string,
  catalog: MilestoneCatalog[],
): Promise<{ poolId: string; loanId: string | null; address: string; toRequest: number; pct: number } | null> {
  const house = await prisma.poolHouse.findUnique({
    where: { id: houseId },
    select: {
      poolId: true, loanId: true, address: true, bankLoanAmount: true, milestones: true,
      loanEntries: { where: { type: "DRAW" }, select: { amount: true, requestedAmount: true, pending: true } },
    },
  });
  if (!house) return null;
  const pct = milestonePct(catalog, house.milestones as HouseMilestones | null);
  const loanAmount = house.bankLoanAmount != null ? Number(house.bankLoanAmount) : 0;
  const alreadyDrawn = house.loanEntries.reduce(
    (s, e) => s + (e.pending ? Number(e.requestedAmount ?? 0) : Number(e.amount)),
    0,
  );
  const { toRequest } = estimatedDrawable({ pct, loanAmount, alreadyDrawn });
  return { poolId: house.poolId, loanId: house.loanId, address: house.address, toRequest: Math.round(toRequest), pct: pct ?? 0 };
}

export async function requestHouseDraw(formData: FormData): Promise<MilestoneFormState> {
  const houseId = String(formData.get("houseId") ?? "").trim();
  if (!houseId) return { error: "Casa inválida." };
  const catalog = await loadMilestoneCatalog();
  const d = await drawableForHouse(houseId, catalog);
  if (!d) return { error: "Casa não encontrada." };
  if (!d.loanId) return { error: "A casa não tem financiamento vinculado." };
  if (d.toRequest <= 0) return { error: "Nada a requisitar — o draw já cobre o % de obra atual." };

  const today = new Date();
  await prisma.poolLoanEntry.create({
    data: {
      loanId: d.loanId,
      houseId,
      type: "DRAW",
      pending: true,
      date: today,
      amount: 0,
      requestedAmount: d.toRequest,
      requestDate: today,
      memo: `Draw por marcos — obra em ${d.pct}%`,
    },
  });
  await logInvestmentAudit({
    poolId: d.poolId,
    entity: "HOUSE",
    entityId: houseId,
    action: "PAYMENT",
    summary: `Requisitou draw de $${d.toRequest.toLocaleString("en-US")} (obra ${d.pct}%) · ${d.address.split(",")[0]}`,
  });
  revalidatePath(`/pools/${d.poolId}`);
  return { ok: true };
}

// Lote/pool: requisita draw de TODAS as casas com drawable > 0 (opcionalmente de um loan).
export async function requestBatchDraw(_prev: MilestoneFormState, formData: FormData): Promise<MilestoneFormState> {
  const poolId = String(formData.get("poolId") ?? "").trim();
  const loanFilter = String(formData.get("loanId") ?? "").trim() || null;
  if (!poolId) return { error: "Pool inválido." };
  const catalog = await loadMilestoneCatalog();
  const houses = await prisma.poolHouse.findMany({ where: { poolId }, select: { id: true } });

  const today = new Date();
  let count = 0;
  let total = 0;
  for (const h of houses) {
    const d = await drawableForHouse(h.id, catalog);
    if (!d || !d.loanId || d.toRequest <= 0) continue;
    if (loanFilter && d.loanId !== loanFilter) continue;
    await prisma.poolLoanEntry.create({
      data: {
        loanId: d.loanId,
        houseId: h.id,
        type: "DRAW",
        pending: true,
        date: today,
        amount: 0,
        requestedAmount: d.toRequest,
        requestDate: today,
        memo: `Draw em lote por marcos — obra em ${d.pct}%`,
      },
    });
    count++;
    total += d.toRequest;
  }
  if (count === 0) return { error: "Nenhuma casa com draw a requisitar no momento." };
  await logInvestmentAudit({
    poolId,
    entity: "HOUSE",
    action: "PAYMENT",
    summary: `Requisitou draw em lote: $${total.toLocaleString("en-US")} em ${count} casa(s)`,
  });
  revalidatePath(`/pools/${poolId}`);
  return { ok: true };
}
