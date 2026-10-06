"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { D, type Decimal } from "@/lib/money";
import { capTable, memberName, position } from "@/lib/pools/math";
import { logInvestmentAudit } from "@/lib/audit";
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

// nome legível do sócio (party OU company) para os resumos de auditoria
async function auditMemberName(memberId: string): Promise<string> {
  const m = await prisma.poolMember.findUnique({
    where: { id: memberId },
    include: { party: true, company: true },
  });
  return m ? memberName(m) : memberId;
}
const auditMoney = (v: unknown) => "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 });

// "company:<id>" | "party:<id>" | null → campos da entidade de performance (um dos dois)
function performancePayeeData(v: string | null | undefined) {
  const [kind, id] = String(v ?? "").split(":");
  return {
    performancePayeeCompanyId: kind === "company" && id ? id : null,
    performancePayeePartyId: kind === "party" && id ? id : null,
  };
}

// ── Pool ─────────────────────────────────────────────────────
// Status do pool é DERIVADO dos fatos (16/07) — o stepper virou indicador; a derivação
// vive em lib/pools/status-derive + status-recompute, chamada nos write-paths.

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
      // performance (06/10): % do acordo guardado direto + entidade genérica que recebe
      performancePct: d.performancePct,
      ...performancePayeeData(d.performancePayee),
      performanceWaiveRemaining: d.performanceWaiveRemaining,
      ownEntity: d.ownEntity,
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
      performancePct: d.performancePct,
      ...performancePayeeData(d.performancePayee),
      performanceWaiveRemaining: d.performanceWaiveRemaining,
      ownEntity: d.ownEntity,
      profitShareTiming: d.profitShareTiming,
      fundingDeadline: d.fundingDeadline,
      startDate: d.startDate,
      plannedEndDate: d.plannedEndDate,
      effectiveEndDate: d.effectiveEndDate,
      notes: d.notes,
      ...(status.success ? { status: status.data as PoolStatus } : {}),
      // entidade do pool (17/07): editável aqui — os badges de pendência apontam p/ cá
      ...(formData.has("companyId")
        ? { companyId: String(formData.get("companyId") ?? "").trim() || null }
        : {}),
      ...(formData.has("noteLoanId")
        ? { noteLoanId: String(formData.get("noteLoanId") ?? "").trim() || null }
        : {}),
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

// Atalho da lista de reservas (06/10): o pool NÃO tem LLC própria → sem provisão de encerramento
export async function setPoolOwnEntity(formData: FormData): Promise<void> {
  const poolId = String(formData.get("poolId") ?? "");
  if (!poolId) return;
  const ownEntity = formData.get("ownEntity") === "1";
  await prisma.investmentPool.update({ where: { id: poolId }, data: { ownEntity } });
  await logInvestmentAudit({
    poolId, entity: "POOL", entityId: poolId, action: "UPDATE",
    summary: ownEntity ? "Pool marcado como LLC própria (provisiona encerramento)" : "Pool marcado como dentro de outra empresa (sem provisão de encerramento)",
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

// Atualização PARCIAL da casa (página em linha do tempo, 05/10): só os campos presentes no
// form são gravados — cada etapa tem a sua form pequena. Capital próprio e custos reais são
// cache do extrato (lib/pools/house-cash) e não estão mais no schema; status é derivado
// (ignorado mesmo que algum form antigo o mande).
const HOUSE_CACHE_FIELDS = ["ownCapital", "actualLotCost", "actualBuildCost", "status"] as const;

export async function patchHouse(
  houseId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = Object.fromEntries(formData);
  for (const k of HOUSE_CACHE_FIELDS) delete raw[k];
  const parsed = houseSchema.partial().safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid data." };
  const d = parsed.data as Record<string, unknown>;
  for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
  const house = await prisma.poolHouse.update({ where: { id: houseId }, data: d });
  const { recomputePoolStatuses } = await import("@/lib/pools/status-recompute");
  await recomputePoolStatuses(house.poolId);
  revalidatePath(`/pools/${house.poolId}`);
  revalidatePath(`/pools/${house.poolId}/houses/${houseId}`);
  return { ok: Date.now() };
}

// Carimba (ou limpa) UMA data da linha do tempo — os chips da página da casa. O status se
// deriva dela (16/07): status da casa NÃO tem caminho manual.
const HOUSE_DATE_FIELDS = new Set([
  "lotContractDate", "lotPaidDate", "permitAppliedDate", "permitIssuedDate",
  "buildStartDate", "coDate", "listedDate", "contractDate", "saleDate",
]);

export async function setHouseDate(formData: FormData): Promise<void> {
  const houseId = String(formData.get("houseId") ?? "");
  const field = String(formData.get("field") ?? "");
  if (!houseId || !HOUSE_DATE_FIELDS.has(field)) return;
  const raw = String(formData.get("date") ?? "").trim();
  const date = raw ? new Date(raw) : null;
  if (date && Number.isNaN(date.getTime())) return;
  const house = await prisma.poolHouse.update({ where: { id: houseId }, data: { [field]: date } });
  const { recomputePoolStatuses } = await import("@/lib/pools/status-recompute");
  await recomputePoolStatuses(house.poolId);
  revalidatePath(`/pools/${house.poolId}`);
  revalidatePath(`/pools/${house.poolId}/houses/${houseId}`);
}

// ── Extrato da casa (05/10) ──────────────────────────────────
// Lançamentos de capital próprio / custos / devolução ao pool. Depois de cada gravação o
// cache da casa (ownCapital, lote e obra reais) é recomputado e o status do pool também.

async function afterHouseCashChange(houseId: string): Promise<string> {
  const { recomputeHouseCash } = await import("@/lib/pools/house-cash");
  await recomputeHouseCash(houseId);
  const house = await prisma.poolHouse.findUniqueOrThrow({ where: { id: houseId }, select: { poolId: true } });
  const { recomputePoolStatuses } = await import("@/lib/pools/status-recompute");
  await recomputePoolStatuses(house.poolId);
  revalidatePath(`/pools/${house.poolId}`);
  revalidatePath(`/pools/${house.poolId}/houses/${houseId}`);
  return house.poolId;
}

export async function addHouseCashEntry(
  houseId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const dateRaw = String(formData.get("date") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").replace(/,/g, ""));
  if (!dateRaw || !category) return { error: "Data e tipo são obrigatórios." };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Valor deve ser maior que 0." };
  const house = await prisma.poolHouse.findUnique({ where: { id: houseId }, select: { poolId: true, address: true } });
  if (!house) return { error: "Casa não encontrada." };
  const { kindForCategory, CATEGORY_LABEL } = await import("@/lib/pools/house-cash");
  const entry = await prisma.houseCashEntry.create({
    data: {
      houseId,
      kind: kindForCategory(category),
      category,
      date: new Date(dateRaw),
      amount,
      memo: String(formData.get("memo") ?? "").trim() || null,
    },
  });
  await afterHouseCashChange(houseId);
  await logInvestmentAudit({
    poolId: house.poolId,
    entity: "HOUSE",
    entityId: entry.id,
    action: "CREATE",
    summary: `${house.address}: ${CATEGORY_LABEL[category] ?? category} ${auditMoney(amount)}`,
  });
  return { ok: Date.now() };
}

// Edita um lançamento do extrato da casa (data, valor, memo). Abertura que ganha data real
// deixa de ser abertura; sem data informada continua abertura (só o valor muda).
export async function updateHouseCashEntry(
  entryId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const entry = await prisma.houseCashEntry.findUnique({ where: { id: entryId }, include: { house: { select: { poolId: true, address: true } } } });
  if (!entry) return { error: "Lançamento não encontrado." };
  const amount = Number(String(formData.get("amount") ?? "").replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Valor deve ser maior que 0." };
  const dateRaw = String(formData.get("date") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;
  const before = Number(entry.amount);
  await prisma.houseCashEntry.update({
    where: { id: entryId },
    data: {
      amount,
      memo,
      ...(dateRaw ? { date: new Date(dateRaw), opening: false } : {}),
    },
  });
  await afterHouseCashChange(entry.houseId);
  await logInvestmentAudit({
    poolId: entry.house.poolId,
    entity: "HOUSE",
    entityId: entryId,
    action: "UPDATE",
    summary: `${entry.house.address}: ajustou ${entry.category} de ${auditMoney(before)} para ${auditMoney(amount)}${dateRaw && entry.opening ? ` (abertura datada ${dateRaw})` : ""}`,
  });
  return { ok: Date.now() };
}

export async function deleteHouseCashEntry(formData: FormData): Promise<void> {
  const id = String(formData.get("entryId") ?? "");
  if (!id) return;
  const entry = await prisma.houseCashEntry.findUnique({ where: { id }, include: { house: { select: { poolId: true, address: true } } } });
  if (!entry) return;
  await prisma.houseCashEntry.delete({ where: { id } });
  await afterHouseCashChange(entry.houseId);
  await logInvestmentAudit({
    poolId: entry.house.poolId,
    entity: "HOUSE",
    entityId: id,
    action: "DELETE",
    summary: `${entry.house.address}: removeu lançamento de ${auditMoney(entry.amount)} (${entry.category})`,
  });
}

// Devolve ao caixa do pool o saldo parado na casa (banco pagou mais que a obra). O valor é
// o saldo do extrato na hora do clique — lançamento RETURN_TO_POOL, auditável e apagável.
export async function returnExcessToPool(formData: FormData): Promise<void> {
  const houseId = String(formData.get("houseId") ?? "");
  const amount = Number(String(formData.get("amount") ?? "").replace(/,/g, ""));
  if (!houseId || !Number.isFinite(amount) || amount <= 0) return;
  const house = await prisma.poolHouse.findUnique({ where: { id: houseId }, select: { poolId: true, address: true } });
  if (!house) return;
  const entry = await prisma.houseCashEntry.create({
    data: { houseId, kind: "RETURN_TO_POOL", category: "RETURN_TO_POOL", date: new Date(), amount, memo: "Excedente do banco devolvido ao caixa do pool" },
  });
  await afterHouseCashChange(houseId);
  await logInvestmentAudit({
    poolId: house.poolId,
    entity: "HOUSE",
    entityId: entry.id,
    action: "CREATE",
    summary: `${house.address}: devolveu excedente de ${auditMoney(amount)} ao caixa do pool`,
  });
}

// Traz uma transação do GL do QuickBooks para o extrato da casa (conferência, etapa 3).
// Se a casa tem uma ABERTURA da mesma categoria com o mesmo valor, a abertura ganha a data e a
// proveniência (não duplica); senão nasce um lançamento COST novo com a data do GL.
export async function importGlTxnToHouse(formData: FormData): Promise<void> {
  const houseId = String(formData.get("houseId") ?? "");
  const txnId = String(formData.get("txnId") ?? "");
  const category = String(formData.get("category") ?? "OTHER");
  // target: "add" = soma como custo novo; "rec:<entryId>" = reconcilia com lançamento existente
  const target = String(formData.get("target") ?? "add");
  if (!houseId || !txnId) return;
  const [house, txn, dup] = await Promise.all([
    prisma.poolHouse.findUnique({ where: { id: houseId }, select: { poolId: true, address: true } }),
    prisma.ledgerTxn.findUnique({ where: { id: txnId } }),
    prisma.houseCashEntry.findUnique({ where: { glTxnId: txnId } }),
  ]);
  if (!house || !txn || dup) return;
  const amount = Math.abs(Number(txn.amount));
  const memo = [txn.rawName, txn.description].filter(Boolean).join(" · ") || txn.account;
  const dateIso = txn.date.toISOString().slice(0, 10);

  if (target.startsWith("rec:")) {
    // RECONCILIAR: o GL comprova data e origem do lançamento que já existe; o valor do
    // lançamento fica (é a verdade da casa) — diferença, se houver, vai para o memo
    const entry = await prisma.houseCashEntry.findUnique({ where: { id: target.slice(4) } });
    if (!entry || entry.houseId !== houseId || entry.glTxnId) return;
    const diff = Math.round((Number(entry.amount) - amount) * 100) / 100;
    await prisma.houseCashEntry.update({
      where: { id: entry.id },
      data: {
        date: txn.date,
        opening: false,
        glTxnId: txnId,
        memo: `GL: ${memo}${Math.abs(diff) >= 0.01 ? ` · GL ${auditMoney(amount)} vs lançamento ${auditMoney(entry.amount)}` : ""}`,
      },
    });
    await afterHouseCashChange(houseId);
    await logInvestmentAudit({
      poolId: house.poolId, entity: "HOUSE", entityId: houseId, action: "UPDATE",
      summary: `${house.address}: reconciliou ${entry.category} ${auditMoney(entry.amount)} com o GL (${dateIso}${Math.abs(diff) >= 0.01 ? `, GL ${auditMoney(amount)}` : ""})`,
    });
    return;
  }
  // SOMAR: custo novo da casa com a data do GL (aumenta o custo real)
  await prisma.houseCashEntry.create({
    data: { houseId, kind: "COST", category, date: txn.date, amount, memo: `GL: ${memo}`, glTxnId: txnId },
  });
  await afterHouseCashChange(houseId);
  await logInvestmentAudit({
    poolId: house.poolId, entity: "HOUSE", entityId: houseId, action: "CREATE",
    summary: `${house.address}: somou do GL ${auditMoney(amount)} (${category}) · ${dateIso}`,
  });
}

// ── Registrar venda (05/10) ──────────────────────────────────
// Uma ação só, em 2 estágios: CONTRACT (data + preço) e CLOSING (data, preço final, payoff,
// líquido recebido → closing cost derivado + payoff/reconveyance lançados no loan da casa).
// O status (Sob contrato / Vendida) e o do pool (Closing) derivam dos fatos gravados.
export async function registerSale(
  houseId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const stage = String(formData.get("stage") ?? "CONTRACT");
  const money = (k: string) => {
    const s = String(formData.get(k) ?? "").replace(/,/g, "").trim();
    if (s === "") return null;
    const v = Number(s);
    return Number.isFinite(v) ? v : NaN;
  };
  const date = (k: string) => {
    const s = String(formData.get(k) ?? "").trim();
    return s ? new Date(s) : null;
  };
  const house = await prisma.poolHouse.findUnique({ where: { id: houseId } });
  if (!house) return { error: "Casa não encontrada." };

  const soldPrice = money("soldPrice");
  if (soldPrice == null || Number.isNaN(soldPrice) || soldPrice <= 0) return { error: "Informe o preço de venda." };

  if (stage === "CONTRACT") {
    const contractDate = date("contractDate");
    if (!contractDate) return { error: "Informe a data do contrato." };
    await prisma.poolHouse.update({ where: { id: houseId }, data: { contractDate, soldPrice } });
    const { recomputePoolStatuses } = await import("@/lib/pools/status-recompute");
    await recomputePoolStatuses(house.poolId);
    await logInvestmentAudit({
      poolId: house.poolId, entity: "HOUSE", entityId: houseId, action: "UPDATE",
      summary: `${house.address}: sob contrato de venda por ${auditMoney(soldPrice)}`,
    });
    revalidatePath(`/pools/${house.poolId}`);
    revalidatePath(`/pools/${house.poolId}/houses/${houseId}`);
    return { ok: Date.now() };
  }

  const saleDate = date("saleDate");
  const netReceived = money("netReceived");
  const payoffAmount = money("payoffAmount") ?? 0;
  if (!saleDate) return { error: "Informe a data do closing." };
  if (netReceived == null || Number.isNaN(netReceived) || netReceived < 0) return { error: "Informe o líquido recebido em conta." };
  if (Number.isNaN(payoffAmount) || payoffAmount < 0) return { error: "Payoff inválido." };
  const closingCost = Math.round((soldPrice - payoffAmount - netReceived) * 100) / 100;
  if (closingCost < 0) return { error: "Venda − payoff − recebido deu negativo: confira os valores." };

  await prisma.poolHouse.update({
    where: { id: houseId },
    data: {
      saleDate, soldPrice, netReceived, payoffAmount, closingCost,
      // contrato sem data registrada → assume o closing (fato mínimo p/ a linha do tempo)
      ...(house.contractDate == null ? { contractDate: saleDate } : {}),
    },
  });
  // payoff vai para o loan DA CASA — mesma rotina do botão da página do Loan (sem duplicar)
  if (payoffAmount > 0) {
    const { generatePayoffFromHouse } = await import("@/lib/actions/pool-loan");
    const fd = new FormData();
    fd.set("poolId", house.poolId);
    fd.set("houseId", houseId);
    await generatePayoffFromHouse(fd);
  }
  const { recomputePoolStatuses } = await import("@/lib/pools/status-recompute");
  await recomputePoolStatuses(house.poolId);
  await logInvestmentAudit({
    poolId: house.poolId, entity: "HOUSE", entityId: houseId, action: "UPDATE",
    summary: `${house.address}: vendida por ${auditMoney(soldPrice)} · líquido ${auditMoney(netReceived)}${payoffAmount > 0 ? ` · payoff ${auditMoney(payoffAmount)}` : ""}`,
  });
  revalidatePath(`/pools/${house.poolId}`);
  revalidatePath(`/pools/${house.poolId}/houses/${houseId}`);
  revalidatePath(`/pools/${house.poolId}/loan`);
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

  // regra do Stefan (16/07): com o pool ATIVO, aportes de quem já participa continuam
  // liberados — o que fecha é a ENTRADA de sócio novo (cap table congelado)
  const poolRow = await prisma.investmentPool.findUnique({ where: { id: poolId }, select: { status: true } });
  if (poolRow && poolRow.status !== "FUNDING")
    return {
      error:
        "Cap table fechado — o pool já saiu da captação. Entrada de novos sócios só na janela de Funding; aportes dos sócios atuais e transferências continuam liberados.",
    };

  const dup = await prisma.poolMember.findFirst({
    where: { poolId, ...(kind === "party" ? { partyId: id } : { companyId: id }) },
  });
  if (dup) return { error: "This investor is already a member of the pool." };

  const created = await prisma.poolMember.create({
    data: {
      poolId,
      role,
      ...(kind === "party" ? { partyId: id } : { companyId: id }),
    },
  });
  await logInvestmentAudit({
    poolId,
    entity: "MEMBER",
    entityId: created.id,
    action: "CREATE",
    summary: `Novo sócio (${role === "MANAGER" ? "Manager" : "Investidor"}): ${await auditMemberName(created.id)}`,
  });
  revalidatePath(`/pools/${poolId}`);
  return undefined;
}

export async function deleteMember(formData: FormData): Promise<void> {
  const id = String(formData.get("memberId") ?? "");
  if (!id) return;
  const entries = await prisma.poolContribution.count({ where: { memberId: id } });
  if (entries > 0) return; // com lançamentos não apaga — trilha de auditoria
  const name = await auditMemberName(id);
  const member = await prisma.poolMember.delete({ where: { id } });
  await logInvestmentAudit({
    poolId: member.poolId,
    entity: "MEMBER",
    entityId: id,
    action: "DELETE",
    summary: `Removeu sócio: ${name}`,
  });
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
  // regra 05/10: fora do Funding todo dinheiro novo entra por CHAMADA (fica registrado quanto
  // cabia a cada sócio e quem cobriu o quê); transferência de units segue livre
  if (pool.status !== "FUNDING")
    return { error: "Captação encerrada — aporte novo entra por 📣 Chamada de capital (ou transferência de units)." };

  // classificação do dinheiro (regra da carteira, aprovada 19/07): AUTO (presunção da
  // carteira) | ROLLOVER (vincula a distribuição reusada — fato) | NEW (força novo)
  const classification = String(formData.get("classification") ?? "AUTO");
  const rolloverOfDistributionId =
    classification === "ROLLOVER" ? String(formData.get("rolloverOfDistributionId") ?? "").trim() || null : null;
  if (classification === "ROLLOVER" && !rolloverOfDistributionId)
    return { error: "Escolha a distribuição reusada." };

  const units = D(d.amount).div(pool.unitPrice);
  const entry = await prisma.poolContribution.create({
    data: {
      memberId: d.memberId,
      kind: "CONTRIBUTION",
      date: d.date,
      amount: d.amount,
      units,
      memo: d.memo,
      rolloverOfDistributionId,
      newMoneyOverride: classification === "NEW",
    },
  });
  await logInvestmentAudit({
    poolId,
    entity: "CONTRIBUTION",
    entityId: entry.id,
    action: "CREATE",
    summary: `Aporte de ${auditMoney(d.amount)} · ${await auditMemberName(d.memberId)}${classification !== "AUTO" ? ` (${classification === "NEW" ? "dinheiro novo" : "rollover"})` : ""}`,
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
  await logInvestmentAudit({
    poolId,
    entity: "TRANSFER",
    action: "CREATE",
    summary: `Transferência de ${auditMoney(d.amount)} · ${await auditMemberName(d.fromMemberId)} → ${await auditMemberName(d.toMemberId)}`,
  });
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
  await logInvestmentAudit({
    poolId: poolId || entry.memberId,
    entity: entry.transferGroupId ? "TRANSFER" : "CONTRIBUTION",
    entityId: id,
    action: "DELETE",
    summary: `Removeu ${entry.transferGroupId ? "transferência" : "aporte"} de ${auditMoney(entry.amount)} · ${await auditMemberName(entry.memberId)}`,
  });
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
  const raw = Number(String(formData.get("amount") ?? "").replace(/,/g, ""));
  if (!dateRaw || !description) return { error: "Data e descrição são obrigatórias." };
  if (!Number.isFinite(raw) || raw <= 0) return { error: "Valor deve ser maior que 0." };
  // RECEITA do pool (06/10): crédito do lender, reembolso, juros de conta — mesmo registro das
  // despesas com valor NEGATIVO e sempre recebida (PAID). Entra no caixa e no lucro distribuível,
  // sem virar aporte, unit ou empréstimo.
  const income = formData.get("direction") === "IN";
  const category = String(formData.get("category") ?? (income ? "OTHER_INCOME" : "OTHER"));
  const status = income ? "PAID" : formData.get("status") === "PAID" ? "PAID" : "PROVISIONED";
  const amount = income ? -raw : raw;
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

// Cria a chamada de capital PRO RATA às units ATUAIS (regra 05/10: % atual, não o inicial) e
// gera as linhas por sócio. Opcionalmente já registra os recebimentos (campos
// `received:<memberId>`, quando o dinheiro já entrou): valor exato, parcial, zero ("não
// participa") ou acima do pro rata (cobriu a diferença — dilui os demais). Cada recebido > 0
// vira aporte CAPITAL_CALL ao preço da unit, sem regra de múltiplo (essa fica no Funding).
export async function createCapitalCall(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const dateRaw = String(formData.get("date") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const total = Number(String(formData.get("totalAmount") ?? "").replace(/,/g, ""));
  if (!dateRaw || !reason) return { error: "Data e motivo são obrigatórios." };
  if (!Number.isFinite(total) || total <= 0) return { error: "Total deve ser maior que 0." };
  const registerNow = formData.get("registerNow") === "1";

  const pool = await prisma.investmentPool.findUnique({ where: { id: poolId }, select: { unitPrice: true } });
  if (!pool) return { error: "Pool não encontrado." };
  const members = await prisma.poolMember.findMany({
    where: { poolId },
    include: { entries: true, party: true, company: true },
  });
  const table = capTable(members);
  if (table.totalUnits.isZero()) return { error: "Sem units emitidas — nada a chamar." };

  const totalD = D(total);
  const lines = table.rows
    .filter((r) => r.units.gt(0))
    .map((r) => ({
      memberId: r.memberId,
      amount: totalD.mul(r.units).div(table.totalUnits).toDecimalPlaces(2),
      received: null as number | null,
    }));
  const allocated = lines.reduce((s, l) => s.add(l.amount), D(0));
  const residue = totalD.sub(allocated);
  if (!residue.isZero() && lines.length > 0) {
    const biggest = lines.reduce((a, b) => (a.amount.gte(b.amount) ? a : b));
    biggest.amount = biggest.amount.add(residue);
  }
  if (registerNow) {
    for (const l of lines) {
      const raw = String(formData.get(`received:${l.memberId}`) ?? "").replace(/,/g, "").trim();
      const v = raw === "" ? Number(l.amount) : Number(raw);
      if (!Number.isFinite(v) || v < 0) return { error: "Valor recebido inválido." };
      l.received = Math.round(v * 100) / 100;
    }
  }

  const date = new Date(dateRaw);
  const call = await prisma.$transaction(async (tx) => {
    const created = await tx.poolCapitalCall.create({
      data: {
        poolId,
        date,
        totalAmount: total,
        reason,
        memo: String(formData.get("memo") ?? "").trim() || null,
        lines: { create: lines.map((l) => ({ memberId: l.memberId, amount: l.amount })) },
      },
      include: { lines: true },
    });
    if (registerNow) {
      for (const line of created.lines) {
        const received = lines.find((l) => l.memberId === line.memberId)!.received!;
        const contribution =
          received > 0
            ? await tx.poolContribution.create({
                data: {
                  memberId: line.memberId,
                  kind: "CAPITAL_CALL",
                  date,
                  amount: received,
                  units: D(received).div(pool.unitPrice),
                  memo: `Capital call ${dateRaw} — ${reason}`,
                },
              })
            : null;
        await tx.poolCapitalCallLine.update({
          where: { id: line.id },
          data: { paid: true, receivedAmount: received, paidAt: date, contributionId: contribution?.id ?? null },
        });
      }
    }
    return created;
  });
  const receivedTotal = registerNow ? lines.reduce((s, l) => s + (l.received ?? 0), 0) : 0;
  await logInvestmentAudit({
    poolId,
    entity: "CAPITAL_CALL",
    entityId: call.id,
    action: "CREATE",
    summary: `Capital call de ${auditMoney(total)} · ${reason} · ${lines.length} sócio(s)${registerNow ? ` · recebido ${auditMoney(receivedTotal)} na emissão` : ""}`,
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

// Registra o recebimento de uma linha: valor recebido (default = pro rata; 0 = "não
// participa"; acima = cobriu diferença) + data do wire. Recebido > 0 vira aporte CAPITAL_CALL.
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
  const amountRaw = String(formData.get("amount") ?? "").replace(/,/g, "").trim();
  // "Não participa" = recebido 0 (botão `waive`, separado do input de valor)
  const received = formData.get("waive") === "1" ? 0 : amountRaw === "" ? Number(line.amount) : Number(amountRaw);
  if (!Number.isFinite(received) || received < 0) return;

  await prisma.$transaction(async (tx) => {
    const contribution =
      received > 0
        ? await tx.poolContribution.create({
            data: {
              memberId: line.memberId,
              kind: "CAPITAL_CALL",
              date,
              amount: received,
              units: D(received).div(line.call.pool.unitPrice),
              memo: `Capital call ${line.call.date.toISOString().slice(0, 10)} — ${line.call.reason}`,
            },
          })
        : null;
    await tx.poolCapitalCallLine.update({
      where: { id: lineId },
      data: { paid: true, receivedAmount: received, paidAt: date, contributionId: contribution?.id ?? null },
    });
  });
  const diff = received - Number(line.amount);
  await logInvestmentAudit({
    poolId: line.call.poolId,
    entity: "CAPITAL_CALL",
    entityId: line.callId,
    action: "PAYMENT",
    summary:
      received === 0
        ? `Não participou da capital call (pro rata ${auditMoney(line.amount)}) · ${await auditMemberName(line.memberId)}`
        : `Recebeu ${auditMoney(received)} de capital call${Math.abs(diff) >= 0.01 ? ` (pro rata ${auditMoney(line.amount)})` : ""} · ${await auditMemberName(line.memberId)}`,
  });
  revalidatePath(`/pools/${line.call.poolId}`);
  revalidatePath(`/pools/${line.call.poolId}/calls/${line.callId}`);
}

// ── Distribuições ────────────────────────────────────────────

// Distribuição (reformulada 06/10, mock aprovado):
// - linhas por sócio vêm do form (`line:<memberId>`); ausentes → pro rata às units. Sócio "fora"
//   = 0; a soma das linhas tem que fechar com o total (capital) ou com total − performance (lucro).
// - LUCRO: bloco de performance → perfMode PROVISION | PAY | WAIVE | NONE com % aplicado e nota;
//   vira despesa PERFORMANCE (provisionada/paga/waived) ligada à distribuição. Acerto do que já
//   estava provisionado: settleProvisioned PAY | WAIVE | KEEP.
// - GATE: capital acima do distribuível seguro, ou lucro antes de todas vendidas/loans quitados,
//   exige overrideNote (gravado + auditado).
export async function addDistribution(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = distributionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid data." };
  const d = parsed.data;
  const money = (k: string): number | null => {
    const s = String(formData.get(k) ?? "").replace(/,/g, "").trim();
    if (s === "") return null;
    const v = Number(s);
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
  };
  const overrideNote = String(formData.get("overrideNote") ?? "").trim() || null;

  const [members, poolRow, priorDists] = await Promise.all([
    prisma.poolMember.findMany({ where: { poolId }, include: { entries: true, party: true, company: true } }),
    prisma.investmentPool.findUnique({ where: { id: poolId }, select: { performancePct: true, currency: true } }),
    prisma.poolDistribution.findMany({ where: { poolId }, include: { lines: true } }),
  ]);
  const table = capTable(members);
  if (table.totalUnits.isZero()) return { error: "Sem units emitidas — nada a distribuir." };
  // já devolvido / já recebido de lucro por sócio (06/10): devolução rateia pelo SALDO de
  // principal e trava no saldo; lucro desconta adiantamentos
  const receivedBy = (memberId: string, kind: "RETURN_OF_CAPITAL" | "PROFIT") =>
    priorDists.filter((x) => x.kind === kind).reduce((s, x) => s + x.lines.filter((l) => l.memberId === memberId).reduce((z, l) => z + Number(l.amount), 0), 0);
  const saldoOf = (r: (typeof table.rows)[number]) => Math.max(0, Math.round((Number(r.invested) - receivedBy(r.memberId, "RETURN_OF_CAPITAL")) * 100) / 100);

  // ── gate de distribuível / lucro antes do fim — NA DATA da distribuição ──
  const { loadDistributable } = await import("@/lib/pools/distributable-load");
  const gate = await loadDistributable(poolId, d.date);
  const over = d.totalAmount - gate.distributable.safe;
  if (d.kind === "PROFIT" && !gate.distributable.profitAllowed && !overrideNote)
    return { error: `Lucro só com todas as casas vendidas e loans quitados (${gate.distributable.unsoldCount} casa(s) aberta(s), ${gate.distributable.openLoans} loan(s) em aberto). Para distribuir mesmo assim, justifique em "override".` };
  if (over > 0.01 && !overrideNote)
    return { error: `Passa do distribuível seguro NA DATA ${d.date.toISOString().slice(0, 10)} em ${auditMoney(over)} (caixa na data ${auditMoney(gate.cashAsOf)}, seguro ${auditMoney(gate.distributable.safe)}). Reduza o total, mude a data ou justifique em "override".` };
  if (d.kind === "RETURN_OF_CAPITAL") {
    const saldoTotal = table.rows.reduce((s, r) => s + saldoOf(r), 0);
    if (d.totalAmount - saldoTotal > 0.01)
      return { error: `Devolução de ${auditMoney(d.totalAmount)} passa do principal ainda não devolvido (${auditMoney(saldoTotal)}). Acima disso é lucro — use a etapa 2.` };
  }

  // ── performance (só LUCRO) ──
  const perfMode = d.kind === "PROFIT" ? String(formData.get("perfMode") ?? "NONE") : "NONE";
  const perfPctRaw = money("perfPct");
  const perfPct = perfPctRaw == null || Number.isNaN(perfPctRaw) ? (poolRow?.performancePct != null ? Number(poolRow.performancePct) : 0) : perfPctRaw;
  const perfBasis = d.totalAmount; // lucro informado nesta distribuição
  const perfAmount = perfMode === "NONE" ? 0 : Math.round(perfBasis * perfPct) / 100;
  const perfNote = String(formData.get("perfNote") ?? "").trim() || null;
  if (perfMode === "WAIVE" && !perfNote) return { error: "Waiver precisa de motivo (vai para o report e a auditoria)." };
  const netToMembers = perfMode === "PROVISION" || perfMode === "PAY" ? Math.round((d.totalAmount - perfAmount) * 100) / 100 : d.totalAmount;
  const settleProvisioned = String(formData.get("settleProvisioned") ?? "KEEP");

  // ── linhas: do form ou pro rata; soma tem que fechar ──
  const net = D(netToMembers);
  const custom = members.some((m) => formData.has(`line:${m.id}`));
  let lines: Array<{ memberId: string; amount: Decimal }>;
  if (custom) {
    lines = [];
    for (const m of members) {
      const v = money(`line:${m.id}`);
      if (v == null) continue;
      if (Number.isNaN(v) || v < 0) return { error: `Valor inválido para ${memberName(m)}.` };
      // trava no saldo de principal (regra p/ os próximos pools; exceções antigas ficam como estão)
      if (d.kind === "RETURN_OF_CAPITAL") {
        const row = table.rows.find((r) => r.memberId === m.id);
        const saldo = row ? saldoOf(row) : 0;
        if (v - saldo > 0.01)
          return { error: `${memberName(m)}: ${auditMoney(v)} passa do saldo de principal (${auditMoney(saldo)}). Acima do principal é lucro — etapa 2.` };
      }
      if (v > 0) lines.push({ memberId: m.id, amount: D(v) });
    }
    const sum = lines.reduce((s, l) => s.add(l.amount), D(0));
    if (sum.sub(net).abs().gt(0.011))
      return { error: `As linhas somam ${auditMoney(sum)} e o total${perfAmount && netToMembers !== d.totalAmount ? " líquido de performance" : ""} é ${auditMoney(net)}.` };
  } else if (d.kind === "RETURN_OF_CAPITAL") {
    // pro rata ao SALDO de principal de cada sócio (quem já está quitado não recebe)
    const saldos = table.rows.map((r) => ({ memberId: r.memberId, saldo: saldoOf(r) }));
    const saldoTotal = saldos.reduce((s, x) => s + x.saldo, 0);
    lines = saldos
      .filter((x) => x.saldo > 0)
      .map((x) => ({ memberId: x.memberId, amount: net.mul(x.saldo).div(saldoTotal).toDecimalPlaces(2) }));
    const allocated = lines.reduce((s, l) => s.add(l.amount), D(0));
    const residue = net.sub(allocated);
    if (!residue.isZero() && lines.length > 0) {
      const biggest = lines.reduce((a, b) => (a.amount.gte(b.amount) ? a : b));
      biggest.amount = biggest.amount.add(residue);
    }
  } else {
    // lucro: alvo acumulado pro rata às units (lucro já distribuído + este) − o que cada um já
    // recebeu de lucro (adiantamentos entram aqui); negativo vira 0 e o resíduo vai à maior linha
    const profitBefore = table.rows.reduce((s, r) => s + receivedBy(r.memberId, "PROFIT"), 0);
    const cumulative = D(profitBefore).add(net);
    lines = table.rows
      .filter((r) => r.units.gt(0))
      .map((r) => {
        const target = cumulative.mul(r.units).div(table.totalUnits);
        const line = target.sub(receivedBy(r.memberId, "PROFIT")).toDecimalPlaces(2);
        return { memberId: r.memberId, amount: line.lt(0) ? D(0) : line };
      });
    const allocated = lines.reduce((s, l) => s.add(l.amount), D(0));
    const residue = net.sub(allocated);
    if (!residue.isZero() && lines.length > 0) {
      const biggest = lines.reduce((a, b) => (a.amount.gte(b.amount) ? a : b));
      biggest.amount = biggest.amount.add(residue);
    }
    lines = lines.filter((l) => l.amount.gt(0));
  }
  if (lines.length === 0) return { error: "Nenhum sócio recebe nesta distribuição." };

  const dist = await prisma.$transaction(async (tx) => {
    const created = await tx.poolDistribution.create({
      data: {
        poolId,
        kind: d.kind,
        date: d.date,
        totalAmount: netToMembers, // o que SAIU para os sócios; a performance sai como despesa
        houseId: d.houseId,
        memo: d.memo,
        overrideNote,
        lines: { create: lines.map((l) => ({ memberId: l.memberId, amount: l.amount })) },
      },
    });
    if (d.kind === "PROFIT" && perfMode !== "NONE") {
      await tx.poolExpense.create({
        data: {
          poolId,
          date: d.date,
          category: "PERFORMANCE",
          description: `Performance ${perfPct}% sobre ${auditMoney(perfBasis)}${perfNote ? ` — ${perfNote}` : ""}`,
          amount: perfAmount,
          status: perfMode === "PAY" ? "PAID" : perfMode === "PROVISION" ? "PROVISIONED" : "WAIVED",
          distributionId: created.id,
          basisAmount: perfBasis,
          pctApplied: perfPct,
        },
      });
    }
    // acerto do que já estava provisionado (encerramento): pagar ou waiver
    if (d.kind === "PROFIT" && (settleProvisioned === "PAY" || settleProvisioned === "WAIVE")) {
      await tx.poolExpense.updateMany({
        where: { poolId, category: "PERFORMANCE", status: "PROVISIONED" },
        data: { status: settleProvisioned === "PAY" ? "PAID" : "WAIVED" },
      });
    }
    return created;
  });
  await logInvestmentAudit({
    poolId,
    entity: "DISTRIBUTION",
    entityId: dist.id,
    action: "CREATE",
    summary:
      `Distribuição de ${auditMoney(netToMembers)} (${d.kind === "PROFIT" ? "lucro" : "capital"}) · ${lines.length} sócio(s)` +
      (custom ? " · linhas ajustadas" : "") +
      (d.kind === "PROFIT" && perfMode !== "NONE"
        ? ` · performance ${perfPct}% = ${auditMoney(perfAmount)} ${perfMode === "PAY" ? "paga" : perfMode === "PROVISION" ? "provisionada" : "WAIVER"}${perfNote ? ` (${perfNote})` : ""}`
        : "") +
      (settleProvisioned !== "KEEP" ? ` · provisão anterior ${settleProvisioned === "PAY" ? "paga" : "waiver"}` : "") +
      (overrideNote ? ` · OVERRIDE: ${overrideNote}` : ""),
  });
  // distribuição é gatilho de CLOSED (lucro distribuído + caixa devolvido)
  {
    const { recomputePoolStatuses } = await import("@/lib/pools/status-recompute");
    await recomputePoolStatuses(poolId);
  }
  // #69 — avisa os sócios (com acesso ao portal) por e-mail; dormente sem RESEND_API_KEY.
  {
    const { notifyDistribution } = await import("@/lib/mail/notify");
    await notifyDistribution(dist.id);
  }
  revalidatePath(`/pools/${poolId}`);
  return undefined;
}

// Devolução acima do principal já lançada (exceção histórica, ex.: PH-3 LR Homes +$80):
// divide a linha — a parte até o principal fica como capital, o excedente vira uma
// distribuição de LUCRO (adiantamento) na mesma data, só para esse sócio. Caixa não muda.
export async function reclassifyOverReturn(formData: FormData): Promise<void> {
  const lineId = String(formData.get("lineId") ?? "");
  if (!lineId) return;
  const line = await prisma.poolDistributionLine.findUnique({
    where: { id: lineId },
    include: { distribution: true, member: { include: { entries: true, party: true, company: true } } },
  });
  if (!line || line.distribution.kind !== "RETURN_OF_CAPITAL") return;
  const poolId = line.distribution.poolId;
  const invested = line.member.entries.reduce((s, e) => s + (e.kind === "TRANSFER_OUT" ? -1 : 1) * Number(e.amount), 0);
  const roc = await prisma.poolDistributionLine.aggregate({
    _sum: { amount: true },
    where: { memberId: line.memberId, distribution: { kind: "RETURN_OF_CAPITAL" } },
  });
  const excess = Math.round(Math.min(Number(line.amount), Number(roc._sum.amount ?? 0) - invested) * 100) / 100;
  if (excess <= 0) return;
  await prisma.$transaction([
    prisma.poolDistributionLine.update({ where: { id: lineId }, data: { amount: Number(line.amount) - excess } }),
    prisma.poolDistribution.update({ where: { id: line.distributionId }, data: { totalAmount: Number(line.distribution.totalAmount) - excess } }),
    prisma.poolDistribution.create({
      data: {
        poolId,
        kind: "PROFIT",
        date: line.distribution.date,
        totalAmount: excess,
        memo: `Adiantamento de lucro — pago junto com o principal em ${line.distribution.date.toISOString().slice(0, 10)}`,
        lines: { create: [{ memberId: line.memberId, amount: excess, paidStatus: line.paidStatus, paidAt: line.paidAt, paidByEmail: line.paidByEmail, paidRef: line.paidRef }] },
      },
    }),
  ]);
  await logInvestmentAudit({
    poolId,
    entity: "DISTRIBUTION",
    entityId: line.distributionId,
    action: "UPDATE",
    summary: `Reclassificou ${auditMoney(excess)} de ${memberName(line.member)} (acima do principal) como adiantamento de lucro`,
  });
  revalidatePath(`/pools/${poolId}`);
}

// Mesmo acerto, a partir do SÓCIO (faixa na aba 1): pega a devolução mais recente dele e
// reclassifica o excedente acumulado sobre o principal.
export async function reclassifyOverReturnForMember(memberId: string, _formData: FormData): Promise<void> {
  if (!memberId) return;
  const last = await prisma.poolDistributionLine.findFirst({
    where: { memberId, distribution: { kind: "RETURN_OF_CAPITAL" } },
    orderBy: [{ distribution: { date: "desc" } }, { distribution: { createdAt: "desc" } }],
    select: { id: true },
  });
  if (!last) return;
  const fd = new FormData();
  fd.set("lineId", last.id);
  await reclassifyOverReturn(fd);
}

export async function deleteDistribution(formData: FormData): Promise<void> {
  const id = String(formData.get("distributionId") ?? "");
  if (!id) return;
  const dist = await prisma.poolDistribution.delete({ where: { id } });
  await logInvestmentAudit({
    poolId: dist.poolId,
    entity: "DISTRIBUTION",
    entityId: id,
    action: "DELETE",
    summary: `Removeu distribuição de ${auditMoney(dist.totalAmount)}`,
  });
  const { recomputePoolStatuses } = await import("@/lib/pools/status-recompute");
  await recomputePoolStatuses(dist.poolId);
  revalidatePath(`/pools/${dist.poolId}`);
}
