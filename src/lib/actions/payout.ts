"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { logInvestmentAudit } from "@/lib/audit";
import { memberName } from "@/lib/pools/math";
import { investorEntities } from "@/lib/portal/access";
import {
  payoutConfirmHash,
  payoutKeyHash,
  payoutStatus,
  validatePayout,
  type PayoutKeyFields,
} from "@/lib/pools/payout";

/**
 * #69 — conta de recebimento das distribuições.
 *  - savePayoutAccountByMember: OPERADOR preenche/edita (fallback telefone/papel). Sempre
 *    resulta em DRAFT quando a instrução bancária muda; só o sócio confirma.
 *  - confirmPortalPayout: o PRÓPRIO sócio atesta no portal → CONFIRMED (click-wrap).
 *  - markLinePaid / unmarkLinePaid: pagamento por linha, travado até a conta estar CONFIRMED.
 */

export type PayoutFormState = { error?: string; ok?: boolean; message?: string } | undefined;

const money0 = (v: unknown) => "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
const keyOf = (f: PayoutKeyFields): PayoutKeyFields => f;

async function clientIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0]!.trim() : h.get("x-real-ip");
}

function fieldsFromForm(formData: FormData) {
  return {
    beneficiaryName: String(formData.get("beneficiaryName") ?? ""),
    bankName: String(formData.get("bankName") ?? ""),
    routingNumber: String(formData.get("routingNumber") ?? ""),
    accountNumber: String(formData.get("accountNumber") ?? ""),
    accountType: String(formData.get("accountType") ?? ""),
    swift: String(formData.get("swift") ?? ""),
    iban: String(formData.get("iban") ?? ""),
    bankAddress: String(formData.get("bankAddress") ?? ""),
  };
}

// ── Operador: cadastra/edita a conta de um sócio ────────────────────────────
export async function savePayoutAccountByMember(
  memberId: string,
  _prev: PayoutFormState,
  formData: FormData,
): Promise<PayoutFormState> {
  const session = await auth();
  const su = session?.user as { role?: string; email?: string } | undefined;
  if (su?.role !== "ADMIN" && su?.role !== "OPERATOR") return { error: "Sem permissão." };

  const member = await prisma.poolMember.findUnique({
    where: { id: memberId },
    include: { party: true, company: true },
  });
  if (!member) return { error: "Sócio não encontrado." };
  if (!member.partyId && !member.companyId)
    return { error: "Este sócio não tem entidade (Party/Company) vinculada." };

  const v = validatePayout(fieldsFromForm(formData));
  if (!v.ok) return { error: v.error };
  const n = v.normalized;
  const newKeyHash = payoutKeyHash(keyOf(n));

  const where = member.companyId ? { companyId: member.companyId } : { partyId: member.partyId! };
  const existing = await prisma.payoutAccount.findFirst({ where });
  // Se a instrução bancária mudou (ou é nova), volta para DRAFT e limpa a trilha de atesto —
  // qualquer troca de instrução exige nova confirmação do sócio (proteção BEC).
  const changed = !existing || existing.keyHash !== newKeyHash;
  const confirmReset = changed
    ? { status: "DRAFT", confirmedAt: null, confirmedByEmail: null, confirmIp: null, confirmHash: null }
    : {};

  await prisma.payoutAccount.upsert({
    where: member.companyId ? { companyId: member.companyId } : { partyId: member.partyId! },
    create: {
      partyId: member.partyId,
      companyId: member.companyId,
      ...n,
      keyHash: newKeyHash,
      status: "DRAFT",
      enteredByEmail: su.email ?? null,
    },
    update: { ...n, keyHash: newKeyHash, enteredByEmail: su.email ?? null, ...confirmReset },
  });

  await logInvestmentAudit({
    poolId: member.poolId,
    entity: "MEMBER",
    entityId: member.id,
    action: existing ? "UPDATE" : "CREATE",
    summary: `Conta de recebimento ${existing ? "editada" : "cadastrada"} · ${memberName(member)}${changed ? " (aguarda confirmação do sócio)" : ""}`,
  });
  revalidatePath(`/pools/${member.poolId}`);
  return { ok: true, message: changed ? "Conta salva. Falta o sócio confirmar no portal." : "Conta atualizada." };
}

// ── Portal: o sócio atesta a própria conta ──────────────────────────────────
export async function confirmPortalPayout(
  entityKey: string,
  _prev: PayoutFormState,
  formData: FormData,
): Promise<PayoutFormState> {
  const session = await auth();
  const su = session?.user as { id?: string; role?: string; email?: string } | undefined;
  if (!su?.id) return { error: "Sessão expirada. Entre novamente." };

  // Segurança: a entidade tem que pertencer a ESTE login (não aceita entityKey arbitrário).
  const entities = await investorEntities(su.id);
  if (!entities.some((e) => e.key === entityKey)) return { error: "Entidade fora do seu acesso." };

  if (formData.get("attest") !== "on")
    return { error: "Marque a confirmação de que a conta é sua e autoriza os pagamentos." };

  const v = validatePayout(fieldsFromForm(formData));
  if (!v.ok) return { error: v.error };
  const n = v.normalized;
  const at = new Date();
  const email = su.email ?? "";
  const keyHash = payoutKeyHash(keyOf(n));
  const confirmHash = payoutConfirmHash({ key: keyOf(n), entityKey, byEmail: email, at });
  const ip = await clientIp();

  const kind = entityKey.slice(0, 1);
  const id = entityKey.slice(2);
  const link = kind === "c" ? { companyId: id } : { partyId: id };

  await prisma.payoutAccount.upsert({
    where: kind === "c" ? { companyId: id } : { partyId: id },
    create: {
      ...link,
      ...n,
      keyHash,
      status: "CONFIRMED",
      confirmedAt: at,
      confirmedByEmail: email,
      confirmIp: ip,
      confirmHash,
    },
    update: {
      ...n,
      keyHash,
      status: "CONFIRMED",
      confirmedAt: at,
      confirmedByEmail: email,
      confirmIp: ip,
      confirmHash,
    },
  });

  // Audit cross-pool (a conta é da entidade, não de um pool específico).
  // changedBy sai da sessão (que é o próprio sócio) dentro do logInvestmentAudit.
  await logInvestmentAudit({
    entity: "MEMBER",
    action: "ACCEPT",
    summary: `Conta de recebimento confirmada pelo sócio · ${entities.find((e) => e.key === entityKey)?.name ?? entityKey}`,
    meta: { entityKey, confirmHash },
  });
  revalidatePath("/portal");
  return { ok: true, message: "Conta confirmada. Você já pode receber suas distribuições." };
}

// ── Operador: marca/desmarca o wire de uma linha ────────────────────────────
export async function markLinePaid(_prev: PayoutFormState, formData: FormData): Promise<PayoutFormState> {
  const session = await auth();
  const su = session?.user as { role?: string; email?: string } | undefined;
  if (su?.role !== "ADMIN" && su?.role !== "OPERATOR") return { error: "Sem permissão." };

  const lineId = String(formData.get("lineId") ?? "").trim();
  const ref = String(formData.get("paidRef") ?? "").trim() || null;
  if (!lineId) return { error: "Linha inválida." };

  const line = await prisma.poolDistributionLine.findUnique({
    where: { id: lineId },
    include: {
      distribution: { select: { poolId: true, kind: true } },
      member: { include: { party: true, company: true } },
    },
  });
  if (!line) return { error: "Linha não encontrada." };
  if (line.paidStatus === "PAID") return { ok: true }; // idempotente

  // TRAVA: só paga se a conta da entidade estiver CONFIRMED.
  const m = line.member;
  const acc =
    m.companyId || m.partyId
      ? await prisma.payoutAccount.findFirst({
          where: m.companyId ? { companyId: m.companyId } : { partyId: m.partyId! },
        })
      : null;
  if (payoutStatus(acc) !== "CONFIRMED")
    return { error: "A conta de recebimento deste sócio ainda não foi confirmada no portal." };

  await prisma.poolDistributionLine.update({
    where: { id: lineId },
    data: { paidStatus: "PAID", paidAt: new Date(), paidByEmail: su.email ?? null, paidRef: ref },
  });
  await logInvestmentAudit({
    poolId: line.distribution.poolId,
    entity: "DISTRIBUTION",
    entityId: line.distributionId,
    action: "PAYMENT",
    summary: `Wire enviado ${money0(line.amount)} · ${memberName(m)}${ref ? ` (ref ${ref})` : ""}`,
  });
  revalidatePath(`/pools/${line.distribution.poolId}`);
  return { ok: true, message: "Pagamento registrado." };
}

export async function unmarkLinePaid(formData: FormData): Promise<void> {
  const session = await auth();
  const su = session?.user as { role?: string; email?: string } | undefined;
  if (su?.role !== "ADMIN" && su?.role !== "OPERATOR") return;
  const lineId = String(formData.get("lineId") ?? "").trim();
  if (!lineId) return;
  const line = await prisma.poolDistributionLine.findUnique({
    where: { id: lineId },
    include: { distribution: { select: { poolId: true } }, member: { include: { party: true, company: true } } },
  });
  if (!line) return;
  await prisma.poolDistributionLine.update({
    where: { id: lineId },
    data: { paidStatus: "UNPAID", paidAt: null, paidByEmail: null, paidRef: null },
  });
  await logInvestmentAudit({
    poolId: line.distribution.poolId,
    entity: "DISTRIBUTION",
    entityId: line.distributionId,
    action: "UPDATE",
    summary: `Pagamento desmarcado · ${memberName(line.member)}`,
  });
  revalidatePath(`/pools/${line.distribution.poolId}`);
}
