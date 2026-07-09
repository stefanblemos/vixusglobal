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

export type FormState = { error?: string } | undefined;

// ── Pool ─────────────────────────────────────────────────────

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
  redirect(`/pools/${house.poolId}`);
}

export async function deleteHouse(formData: FormData): Promise<void> {
  const id = String(formData.get("houseId") ?? "");
  if (!id) return;
  const house = await prisma.poolHouse.delete({ where: { id } });
  revalidatePath(`/pools/${house.poolId}`);
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
