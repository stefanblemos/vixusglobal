"use server";

// Subscrição online (mock aprovado 19/07/2026): convite → wizard público (/subscribe/
// [token]) → assinatura click-wrap → aceite do Manager. O aceite cria o PoolMember,
// gera o pacote DOCX no data room (por memberId) e arquiva o perfil KYC p/ reuso.
import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { buildJoinderDocx, buildSubscriptionDocx, type SubscriptionDocInput } from "@/lib/subscription/package-docx";
import { MANAGER_NAME, missingForSignature, POOL_COUNTY, type WizardData } from "@/lib/subscription/types";
import type { Jurisdiction, PartyKind } from "@prisma/client";

export type SubFormState = { error?: string; ok?: boolean } | undefined;

function ownerFromForm(formData: FormData): { partyId?: string; companyId?: string } {
  const owner = String(formData.get("owner") ?? "");
  const [kind, id] = owner.split(":");
  if (id && kind === "party") return { partyId: id };
  if (id && kind === "company") return { companyId: id };
  return {};
}

export async function createSubscriptionInvite(
  poolId: string,
  _prev: SubFormState,
  formData: FormData,
): Promise<SubFormState> {
  const pool = await prisma.investmentPool.findUnique({
    where: { id: poolId },
    select: { status: true, unitPrice: true },
  });
  if (!pool) return { error: "Pool não encontrado." };
  if (pool.status !== "FUNDING")
    return { error: "Cap table fechado — convites de subscrição só na janela de Funding." };

  const email = String(formData.get("email") ?? "").trim() || null;
  const unitsRaw = Number(formData.get("units"));
  const units = Number.isFinite(unitsRaw) && unitsRaw > 0 ? unitsRaw : null;

  await prisma.poolSubscription.create({
    data: { poolId, email, units, unitPrice: pool.unitPrice, ...ownerFromForm(formData) },
  });
  revalidatePath(`/pools/${poolId}`);
  return { ok: true };
}

// Salva o draft do wizard (passo a passo). `prefilled` marca que o draft nasceu do
// perfil de uma participação anterior — banner "revise seus dados" no wizard e no aceite.
export async function updateWizardData(token: string, data: WizardData, prefilled?: boolean): Promise<SubFormState> {
  const sub = await prisma.poolSubscription.findUnique({ where: { token }, select: { id: true, status: true } });
  if (!sub) return { error: "Convite não encontrado." };
  if (sub.status !== "INVITED" && sub.status !== "IN_PROGRESS")
    return { error: "Esta subscrição já foi assinada." };
  await prisma.poolSubscription.update({
    where: { id: sub.id },
    data: {
      data: data as object,
      status: "IN_PROGRESS",
      ...(prefilled !== undefined ? { prefilled } : {}),
    },
  });
  return { ok: true };
}

export async function signSubscription(token: string, _prev: SubFormState, formData: FormData): Promise<SubFormState> {
  const sub = await prisma.poolSubscription.findUnique({ where: { token } });
  if (!sub) return { error: "Convite não encontrado." };
  if (sub.status === "SIGNED" || sub.status === "ACCEPTED") return { error: "Já assinada." };
  if (sub.status === "REJECTED") return { error: "Subscrição rejeitada." };

  const signName = String(formData.get("signName") ?? "").trim();
  const consent = formData.get("consent") === "on";
  if (!signName) return { error: "Digite seu nome completo para assinar." };
  if (!consent) return { error: "Marque o consentimento de assinatura eletrônica." };

  const data = (sub.data ?? {}) as WizardData;
  const missing = missingForSignature(data);
  if (missing.length) return { error: "Complete os passos anteriores antes de assinar." };

  const hdrs = await headers();
  const signIp = (hdrs.get("x-forwarded-for") ?? hdrs.get("x-real-ip") ?? "local").split(",")[0].trim();
  const signHash = createHash("sha256").update(JSON.stringify({ token, data, signName })).digest("hex");

  await prisma.poolSubscription.update({
    where: { id: sub.id },
    data: { status: "SIGNED", signName, signIp, signHash, signedAt: new Date() },
  });
  // perfil KYC reutilizável: se o convite já está ligado a uma entidade, arquiva agora
  // (sem units — commitment é por subscrição, identidade é do perfil)
  const { units: _units, ...profileData } = data;
  if (sub.partyId)
    await prisma.investorProfile.upsert({
      where: { partyId: sub.partyId },
      create: { partyId: sub.partyId, data: profileData as object },
      update: { data: profileData as object },
    });
  else if (sub.companyId)
    await prisma.investorProfile.upsert({
      where: { companyId: sub.companyId },
      create: { companyId: sub.companyId, data: profileData as object },
      update: { data: profileData as object },
    });
  revalidatePath(`/pools/${sub.poolId}`);
  return { ok: true };
}

function jurisdictionOf(raw: string | undefined): Jurisdiction {
  const s = (raw ?? "").toLowerCase();
  if (/(usa|u\.s|united states|florida|\bfl\b|texas|california)/.test(s)) return "US";
  if (/(brazil|brasil|\bbr\b)/.test(s)) return "BR";
  if (/portugal|\bpt\b/.test(s)) return "PT";
  return "OTHER";
}

export async function acceptSubscription(_prev: SubFormState, formData: FormData): Promise<SubFormState> {
  const id = String(formData.get("subscriptionId") ?? "");
  const sub = await prisma.poolSubscription.findUnique({
    where: { id },
    include: { pool: { select: { id: true, name: true, code: true, status: true, unitPrice: true } } },
  });
  if (!sub) return { error: "Subscrição não encontrada." };
  if (sub.status !== "SIGNED") return { error: "Só subscrições assinadas podem ser aceitas." };
  const data = (sub.data ?? {}) as WizardData;

  // entidade do sócio: a vinculada no convite, ou uma Party nova criada do questionário
  let partyId = sub.partyId;
  const companyId = sub.companyId;
  if (!partyId && !companyId) {
    if (!data.legalName?.trim()) return { error: "Subscrição sem nome legal — abra o wizard." };
    const party = await prisma.party.create({
      data: {
        kind: (data.type === "INDIVIDUAL" ? "PERSON" : "ENTITY") as PartyKind,
        name: data.legalName.trim(),
        taxJurisdiction: jurisdictionOf(data.jurisdiction),
        taxId: data.tin?.trim() || null,
        controlsTax: false, // investidor externo — fora da sequência de fechamento fiscal
        notes: `Criado pela subscrição online do ${sub.pool.code} (${sub.id}).`,
      },
    });
    partyId = party.id;
  }

  // entrada de sócio NOVO respeita a mesma trava de Funding do addMember
  let member = await prisma.poolMember.findFirst({
    where: { poolId: sub.poolId, ...(partyId ? { partyId } : { companyId: companyId! }) },
  });
  if (!member) {
    if (sub.pool.status !== "FUNDING")
      return { error: "Cap table fechado — o pool já saiu da captação; aceite bloqueado." };
    member = await prisma.poolMember.create({
      data: { poolId: sub.poolId, role: "INVESTOR", ...(partyId ? { partyId } : { companyId: companyId! }) },
    });
  }

  // pacote DOCX gerado e arquivado no data room do sócio (portalVisible: ele vê no portal)
  const docInput: SubscriptionDocInput = {
    poolName: sub.pool.name,
    poolCode: sub.pool.code,
    managerName: MANAGER_NAME,
    county: POOL_COUNTY,
    unitPrice: Number(sub.unitPrice),
    data,
    signName: sub.signName,
    signedAt: sub.signedAt,
    signIp: sub.signIp,
    signHash: sub.signHash,
  };
  const [subDocx, joinderDocx] = await Promise.all([buildSubscriptionDocx(docInput), buildJoinderDocx(docInput)]);
  const stamp = new Date().toISOString().slice(0, 10);
  await prisma.poolDocument.createMany({
    data: [
      {
        poolId: sub.poolId,
        memberId: member.id,
        docType: "SUBSCRIPTION",
        fileName: `Subscription Agreement - ${data.legalName ?? "Investor"} - ${stamp}.docx`,
        pdf: new Uint8Array(subDocx),
        pdfSize: subDocx.length,
        portalVisible: true,
        signedAt: sub.signedAt,
      },
      {
        poolId: sub.poolId,
        memberId: member.id,
        docType: "JOINDER",
        fileName: `Amendment and Joinder - ${data.legalName ?? "Investor"} - ${stamp}.docx`,
        pdf: new Uint8Array(joinderDocx),
        pdfSize: joinderDocx.length,
        portalVisible: true,
        signedAt: sub.signedAt,
      },
    ],
  });

  await prisma.poolSubscription.update({
    where: { id: sub.id },
    data: { status: "ACCEPTED", decidedAt: new Date(), memberId: member.id, partyId, companyId },
  });
  // perfil KYC reutilizável — arquiva/atualiza no aceite (idempotente; a assinatura já
  // pode ter feito para entidades vinculadas, mas garantimos aqui para o caso da Party
  // recém-criada e para robustez)
  const { units: _units, ...profileData } = data;
  if (partyId)
    await prisma.investorProfile.upsert({
      where: { partyId },
      create: { partyId, data: profileData as object },
      update: { data: profileData as object },
    });
  else if (companyId)
    await prisma.investorProfile.upsert({
      where: { companyId },
      create: { companyId, data: profileData as object },
      update: { data: profileData as object },
    });
  revalidatePath(`/pools/${sub.poolId}`);
  return { ok: true };
}

export async function rejectSubscription(formData: FormData): Promise<void> {
  const id = String(formData.get("subscriptionId") ?? "");
  const sub = await prisma.poolSubscription.findUnique({ where: { id }, select: { poolId: true, status: true } });
  if (!sub || sub.status === "ACCEPTED") return;
  await prisma.poolSubscription.update({ where: { id }, data: { status: "REJECTED", decidedAt: new Date() } });
  revalidatePath(`/pools/${sub.poolId}`);
}

export async function deleteSubscription(formData: FormData): Promise<void> {
  const id = String(formData.get("subscriptionId") ?? "");
  const sub = await prisma.poolSubscription.findUnique({ where: { id }, select: { poolId: true, status: true } });
  if (!sub || sub.status === "ACCEPTED") return; // aceita fica: trilha de auditoria
  await prisma.poolSubscription.delete({ where: { id } });
  revalidatePath(`/pools/${sub.poolId}`);
}
