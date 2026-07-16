"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { D } from "@/lib/money";
import { capTable, position } from "@/lib/pools/math";
import {
  contributionSchema,
  distributionSchema,
  houseSchema,
  poolSchema,
  poolStatusSchema,
  transferSchema,
} from "@/lib/validation/pool";
import type { PoolHouseStatus, PoolStatus } from "@prisma/client";

export type FormState = { error?: string; ok?: number } | undefined;

// ── Pool ─────────────────────────────────────────────────────

// Stepper da Overview: muda só o status (Funding → Active → Closing → Closed)
export async function setPoolStatus(poolId: string, status: string): Promise<FormState> {
  const parsed = poolStatusSchema.safeParse(status);
  if (!parsed.success) return { error: "Invalid status." };
  await prisma.investmentPool.update({
    where: { id: poolId },
    data: { status: parsed.data as PoolStatus },
  });
  revalidatePath(`/pools/${poolId}`);
  return { ok: Date.now() };
}

export async function createPool(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = poolSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid data." };
  const d = parsed.data;

  const dup = await prisma.investmentPool.findUnique({ where: { code: d.code } });
  if (dup) return { error: `Code ${d.code} already exists.` };

  const pool = await prisma.investmentPool.create({
    data: {
      code: d.code,
      name: d.name,
      alias: d.alias,
      unitPrice: d.unitPrice,
      targetAmount: d.targetAmount,
      profitSharePct: d.profitSharePct == null ? null : d.profitSharePct / 100,
      profitShareTiming: d.profitShareTiming,
      fundingDeadline: d.fundingDeadline,
      startDate: d.startDate,
      plannedEndDate: d.plannedEndDate,
      effectiveEndDate: d.effectiveEndDate,
      notes: d.notes,
    },
  });
  revalidatePath("/pools");
  redirect(`/pools/${pool.id}`);
}

export async function updatePool(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = poolSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid data." };
  const status = poolStatusSchema.safeParse(formData.get("status"));
  const d = parsed.data;

  const dup = await prisma.investmentPool.findUnique({ where: { code: d.code } });
  if (dup && dup.id !== poolId) return { error: `Code ${d.code} already exists.` };

  await prisma.investmentPool.update({
    where: { id: poolId },
    data: {
      code: d.code,
      name: d.name,
      alias: d.alias,
      unitPrice: d.unitPrice,
      targetAmount: d.targetAmount,
      profitSharePct: d.profitSharePct == null ? null : d.profitSharePct / 100,
      profitShareTiming: d.profitShareTiming,
      fundingDeadline: d.fundingDeadline,
      startDate: d.startDate,
      plannedEndDate: d.plannedEndDate,
      effectiveEndDate: d.effectiveEndDate,
      notes: d.notes,
      ...(status.success ? { status: status.data as PoolStatus } : {}),
    },
  });
  revalidatePath(`/pools/${poolId}`);
  revalidatePath("/pools");
  redirect(`/pools/${poolId}`);
}

// Liga o pool à sua empresa (Company) e/ou à nota participativa (IntercompanyLoan).
export async function linkPoolEntity(formData: FormData): Promise<void> {
  const poolId = String(formData.get("poolId") ?? "");
  if (!poolId) return;
  const companyId = String(formData.get("companyId") ?? "").trim() || null;
  const noteLoanId = String(formData.get("noteLoanId") ?? "").trim() || null;
  await prisma.investmentPool.update({
    where: { id: poolId },
    data: { companyId, noteLoanId },
  });
  revalidatePath(`/pools/${poolId}`);
}

// ── Casas ────────────────────────────────────────────────────

export async function addHouse(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = houseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid data." };
  await prisma.poolHouse.create({
    data: { poolId, ...parsed.data, status: parsed.data.status as PoolHouseStatus },
  });
  revalidatePath(`/pools/${poolId}`);
  return undefined;
}

export async function updateHouse(
  houseId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = houseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid data." };
  const d = parsed.data;
  // "O que entrou em conta" preenchido → closing cost é a diferença (venda − payoff − recebido)
  if (d.closingCost == null && d.soldPrice != null && d.payoffAmount != null && d.netReceived != null) {
    d.closingCost = Math.round((d.soldPrice - d.payoffAmount - d.netReceived) * 100) / 100;
  }
  const house = await prisma.poolHouse.update({
    where: { id: houseId },
    data: { ...d, status: d.status as PoolHouseStatus },
  });
  revalidatePath(`/pools/${house.poolId}`);
  revalidatePath(`/pools/${house.poolId}/houses/${houseId}`);
  // fica na ficha (save bar fixa) — ok muda a cada save p/ o client mostrar "Salvo ✓"
  return { ok: Date.now() };
}

// Stepper da ficha: muda o status e carimba a data do passo (só se ainda vazia — editável
// depois na Linha do tempo). Datas por passo alimentam o simulado × realizado.
const STATUS_DATE: Partial<Record<PoolHouseStatus, "lotPaidDate" | "buildStartDate" | "coDate" | "contractDate" | "saleDate">> = {
  LOT_PURCHASED: "lotPaidDate",
  UNDER_CONSTRUCTION: "buildStartDate",
  FOR_SALE: "coDate",
  UNDER_CONTRACT: "contractDate",
  SOLD: "saleDate",
};

export async function setHouseStatus(houseId: string, status: PoolHouseStatus): Promise<FormState> {
  const house = await prisma.poolHouse.findUnique({ where: { id: houseId } });
  if (!house) return { error: "House not found." };
  const dateField = STATUS_DATE[status];
  const data: Record<string, unknown> = { status };
  if (dateField && house[dateField] == null) data[dateField] = new Date();
  await prisma.poolHouse.update({ where: { id: houseId }, data });
  revalidatePath(`/pools/${house.poolId}`);
  revalidatePath(`/pools/${house.poolId}/houses/${houseId}`);
  return { ok: Date.now() };
}

// Apagar casa vive na FICHA (mock 4/6 — saiu da lista p/ evitar clique acidental);
// depois de apagar, volta para a aba Casas.
export async function deleteHouse(formData: FormData): Promise<void> {
  const id = String(formData.get("houseId") ?? "");
  if (!id) return;
  const house = await prisma.poolHouse.delete({ where: { id } });
  revalidatePath(`/pools/${house.poolId}`);
  redirect(`/pools/${house.poolId}?tab=houses`);
}

// ── Sócios ───────────────────────────────────────────────────

export async function addMember(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // Owner vem como "party:<id>" ou "company:<id>" (mesmo padrão recursivo do Ownership).
  const owner = String(formData.get("owner") ?? "");
  const [kind, id] = owner.split(":");
  if (!id || (kind !== "party" && kind !== "company")) return { error: "Pick the investor." };
  const role = String(formData.get("role") ?? "INVESTOR") === "MANAGER" ? "MANAGER" : "INVESTOR";

  const dup = await prisma.poolMember.findFirst({
    where: { poolId, ...(kind === "party" ? { partyId: id } : { companyId: id }) },
  });
  if (dup) return { error: "This investor is already a member of the pool." };

  await prisma.poolMember.create({
    data: {
      poolId,
      role,
      ...(kind === "party" ? { partyId: id } : { companyId: id }),
    },
  });
  revalidatePath(`/pools/${poolId}`);
  return undefined;
}

export async function deleteMember(formData: FormData): Promise<void> {
  const id = String(formData.get("memberId") ?? "");
  if (!id) return;
  const entries = await prisma.poolContribution.count({ where: { memberId: id } });
  if (entries > 0) return; // com lançamentos não apaga — trilha de auditoria
  const member = await prisma.poolMember.delete({ where: { id } });
  revalidatePath(`/pools/${member.poolId}`);
}

// ── Aportes e transferências ─────────────────────────────────

export async function addContribution(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = contributionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid data." };
  const d = parsed.data;

  const pool = await prisma.investmentPool.findUnique({ where: { id: poolId } });
  if (!pool) return { error: "Pool not found." };
  if (pool.status !== "FUNDING")
    return { error: "Funding window is closed — use a unit transfer instead." };

  const units = D(d.amount).div(pool.unitPrice);
  await prisma.poolContribution.create({
    data: {
      memberId: d.memberId,
      kind: "CONTRIBUTION",
      date: d.date,
      amount: d.amount,
      units,
      memo: d.memo,
    },
  });
  revalidatePath(`/pools/${poolId}`);
  return undefined;
}

export async function transferUnits(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = transferSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid data." };
  const d = parsed.data;
  if (d.fromMemberId === d.toMemberId) return { error: "Seller and buyer must be different." };

  const pool = await prisma.investmentPool.findUnique({ where: { id: poolId } });
  if (!pool) return { error: "Pool not found." };

  const from = await prisma.poolMember.findUnique({
    where: { id: d.fromMemberId },
    include: { entries: true },
  });
  if (!from || from.poolId !== poolId) return { error: "Seller is not a member of this pool." };

  const units = D(d.amount).div(pool.unitPrice);
  const pos = position(from.entries);
  if (pos.units.lt(units))
    return { error: `Seller only has ${pos.units.toFixed(4)} units (${pool.currency} ${pos.invested.toFixed(2)}).` };

  const transferGroupId = randomUUID();
  await prisma.$transaction([
    prisma.poolContribution.create({
      data: {
        memberId: d.fromMemberId,
        kind: "TRANSFER_OUT",
        date: d.date,
        amount: d.amount,
        units,
        transferGroupId,
        memo: d.memo,
      },
    }),
    prisma.poolContribution.create({
      data: {
        memberId: d.toMemberId,
        kind: "TRANSFER_IN",
        date: d.date,
        amount: d.amount,
        units,
        transferGroupId,
        memo: d.memo,
      },
    }),
  ]);
  revalidatePath(`/pools/${poolId}`);
  return undefined;
}

export async function deleteContribution(formData: FormData): Promise<void> {
  const id = String(formData.get("entryId") ?? "");
  const poolId = String(formData.get("poolId") ?? "");
  if (!id) return;
  const entry = await prisma.poolContribution.findUnique({ where: { id } });
  if (!entry) return;
  // Transferência apaga o par inteiro (senão as units somem de um lado só).
  if (entry.transferGroupId) {
    await prisma.poolContribution.deleteMany({ where: { transferGroupId: entry.transferGroupId } });
  } else {
    await prisma.poolContribution.delete({ where: { id } });
  }
  if (poolId) revalidatePath(`/pools/${poolId}`);
}

// ── Change orders (CO) da casa ───────────────────────────────

export async function addChangeOrder(
  houseId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const dateRaw = String(formData.get("date") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").replace(/,/g, ""));
  if (!dateRaw || !description) return { error: "Date and description are required." };
  if (!Number.isFinite(amount) || amount === 0) return { error: "Amount must be a non-zero number." };
  const house = await prisma.poolHouse.findUnique({ where: { id: houseId } });
  if (!house) return { error: "House not found." };
  await prisma.houseChangeOrder.create({
    data: { houseId, date: new Date(dateRaw), description, amount },
  });
  revalidatePath(`/pools/${house.poolId}/houses/${houseId}`);
  revalidatePath(`/pools/${house.poolId}`);
  return undefined;
}

export async function deleteChangeOrder(formData: FormData): Promise<void> {
  const id = String(formData.get("changeOrderId") ?? "");
  if (!id) return;
  const co = await prisma.houseChangeOrder.findUnique({ where: { id }, include: { house: true } });
  if (!co) return;
  await prisma.houseChangeOrder.delete({ where: { id } });
  revalidatePath(`/pools/${co.house.poolId}/houses/${co.houseId}`);
  revalidatePath(`/pools/${co.house.poolId}`);
}

// ── Despesas do pool (abertura, annual report, IR/K-1s) ─────

export async function addPoolExpense(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const dateRaw = String(formData.get("date") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").replace(/,/g, ""));
  if (!dateRaw || !description) return { error: "Date and description are required." };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Amount must be greater than 0." };
  const category = String(formData.get("category") ?? "OTHER");
  const status = formData.get("status") === "PAID" ? "PAID" : "PROVISIONED";
  await prisma.poolExpense.create({
    data: { poolId, date: new Date(dateRaw), category, description, amount, status },
  });
  revalidatePath(`/pools/${poolId}`);
  return undefined;
}

export async function togglePoolExpensePaid(formData: FormData): Promise<void> {
  const id = String(formData.get("expenseId") ?? "");
  if (!id) return;
  const exp = await prisma.poolExpense.findUnique({ where: { id } });
  if (!exp) return;
  await prisma.poolExpense.update({
    where: { id },
    data: { status: exp.status === "PAID" ? "PROVISIONED" : "PAID" },
  });
  revalidatePath(`/pools/${exp.poolId}`);
}

export async function deletePoolExpense(formData: FormData): Promise<void> {
  const id = String(formData.get("expenseId") ?? "");
  if (!id) return;
  const exp = await prisma.poolExpense.delete({ where: { id } });
  revalidatePath(`/pools/${exp.poolId}`);
}

// ── Capital calls ────────────────────────────────────────────

// Cria a chamada de capital PRO RATA às units atuais e gera as linhas por sócio.
// O relatório sai em /pools/[id]/calls/[callId]; cada recebimento vira um aporte
// (kind CAPITAL_CALL, valor exato — sem regra de múltiplo de $1.000).
export async function createCapitalCall(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const dateRaw = String(formData.get("date") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const total = Number(String(formData.get("totalAmount") ?? "").replace(/,/g, ""));
  if (!dateRaw || !reason) return { error: "Date and reason are required." };
  if (!Number.isFinite(total) || total <= 0) return { error: "Total must be greater than 0." };

  const members = await prisma.poolMember.findMany({
    where: { poolId },
    include: { entries: true, party: true, company: true },
  });
  const table = capTable(members);
  if (table.totalUnits.isZero()) return { error: "No units issued — nothing to call." };

  const totalD = D(total);
  const lines = table.rows
    .filter((r) => r.units.gt(0))
    .map((r) => ({
      memberId: r.memberId,
      amount: totalD.mul(r.units).div(table.totalUnits).toDecimalPlaces(2),
    }));
  const allocated = lines.reduce((s, l) => s.add(l.amount), D(0));
  const residue = totalD.sub(allocated);
  if (!residue.isZero() && lines.length > 0) {
    const biggest = lines.reduce((a, b) => (a.amount.gte(b.amount) ? a : b));
    biggest.amount = biggest.amount.add(residue);
  }

  const call = await prisma.poolCapitalCall.create({
    data: {
      poolId,
      date: new Date(dateRaw),
      totalAmount: total,
      reason,
      memo: String(formData.get("memo") ?? "").trim() || null,
      lines: { create: lines.map((l) => ({ memberId: l.memberId, amount: l.amount })) },
    },
  });
  revalidatePath(`/pools/${poolId}`);
  redirect(`/pools/${poolId}/calls/${call.id}`);
}

export async function deleteCapitalCall(formData: FormData): Promise<void> {
  const id = String(formData.get("callId") ?? "");
  if (!id) return;
  const call = await prisma.poolCapitalCall.findUnique({
    where: { id },
    include: { lines: { where: { paid: true } } },
  });
  if (!call || call.lines.length > 0) return; // com recebimento registrado não apaga
  await prisma.poolCapitalCall.delete({ where: { id } });
  revalidatePath(`/pools/${call.poolId}`);
  redirect(`/pools/${call.poolId}?tab=investors`);
}

// Registra o recebimento de uma linha: cria o aporte (CAPITAL_CALL) e marca como pago.
export async function registerCallPayment(formData: FormData): Promise<void> {
  const lineId = String(formData.get("lineId") ?? "");
  if (!lineId) return;
  const line = await prisma.poolCapitalCallLine.findUnique({
    where: { id: lineId },
    include: { call: { include: { pool: true } } },
  });
  if (!line || line.paid) return;
  const dateRaw = String(formData.get("date") ?? "").trim();
  const date = dateRaw ? new Date(dateRaw) : new Date();
  const units = D(line.amount).div(line.call.pool.unitPrice);

  await prisma.$transaction(async (tx) => {
    const contribution = await tx.poolContribution.create({
      data: {
        memberId: line.memberId,
        kind: "CAPITAL_CALL",
        date,
        amount: line.amount,
        units,
        memo: `Capital call ${line.call.date.toISOString().slice(0, 10)} — ${line.call.reason}`,
      },
    });
    await tx.poolCapitalCallLine.update({
      where: { id: lineId },
      data: { paid: true, contributionId: contribution.id },
    });
  });
  revalidatePath(`/pools/${line.call.poolId}`);
  revalidatePath(`/pools/${line.call.poolId}/calls/${line.callId}`);
}

// ── Distribuições ────────────────────────────────────────────

export async function addDistribution(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = distributionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid data." };
  const d = parsed.data;

  const members = await prisma.poolMember.findMany({
    where: { poolId },
    include: { entries: true, party: true, company: true },
  });
  const table = capTable(members);
  if (table.totalUnits.isZero()) return { error: "No units issued yet — nothing to distribute." };

  // Rateio pro rata por units; o resíduo de arredondamento vai para a maior posição.
  const total = D(d.totalAmount);
  const lines = table.rows
    .filter((r) => r.units.gt(0))
    .map((r) => ({
      memberId: r.memberId,
      amount: total.mul(r.units).div(table.totalUnits).toDecimalPlaces(2),
    }));
  const allocated = lines.reduce((s, l) => s.add(l.amount), D(0));
  const residue = total.sub(allocated);
  if (!residue.isZero() && lines.length > 0) {
    const biggest = lines.reduce((a, b) => (a.amount.gte(b.amount) ? a : b));
    biggest.amount = biggest.amount.add(residue);
  }

  await prisma.poolDistribution.create({
    data: {
      poolId,
      kind: d.kind,
      date: d.date,
      totalAmount: d.totalAmount,
      houseId: d.houseId,
      memo: d.memo,
      lines: { create: lines.map((l) => ({ memberId: l.memberId, amount: l.amount })) },
    },
  });
  revalidatePath(`/pools/${poolId}`);
  return undefined;
}

export async function deleteDistribution(formData: FormData): Promise<void> {
  const id = String(formData.get("distributionId") ?? "");
  if (!id) return;
  const dist = await prisma.poolDistribution.delete({ where: { id } });
  revalidatePath(`/pools/${dist.poolId}`);
}
