"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { logInvestmentAudit } from "@/lib/audit";

/**
 * Saldo de ABERTURA do investidor — o que ele já aportou/recebeu em projetos ANTERIORES que
 * não entram no sistema. É um agregado informado, não lançamento rastreado: por isso é
 * exclusivo de ADMIN, fica TRAVADO após salvar e toda alteração é auditada (quem, quando,
 * de quanto para quanto). Credita a carteira — o próximo aporte vira reuso.
 */

export type LegacyFormState = { error?: string; ok?: boolean; message?: string } | undefined;

// key no formato do app: "c_<companyId>" | "p_<partyId>"
function entityWhere(key: string): { partyId: string } | { companyId: string } | null {
  const kind = key.slice(0, 1);
  const id = key.slice(2);
  if (!id) return null;
  if (kind === "c") return { companyId: id };
  if (kind === "p") return { partyId: id };
  return null;
}

const money = (v: FormDataEntryValue | null): number => {
  const n = Number(String(v ?? "").replace(/[^0-9.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : NaN;
};

async function requireAdmin(): Promise<string | null> {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  return role === "ADMIN" ? (session?.user?.email ?? "admin") : null;
}

export async function saveInvestorLegacy(_prev: LegacyFormState, formData: FormData): Promise<LegacyFormState> {
  if (!(await requireAdmin())) return { error: "Apenas ADMIN pode informar o saldo de abertura." };

  const key = String(formData.get("entityKey") ?? "").trim();
  const where = entityWhere(key);
  if (!where) return { error: "Entidade inválida." };

  const invested = money(formData.get("invested"));
  const returned = money(formData.get("returned"));
  if (!Number.isFinite(invested) || !Number.isFinite(returned)) return { error: "Valores inválidos." };
  const sinceRaw = String(formData.get("since") ?? "").trim();
  const since = sinceRaw ? new Date(`${sinceRaw}T00:00:00.000Z`) : null;
  if (sinceRaw && Number.isNaN(since!.getTime())) return { error: "Data inválida." };
  const note = String(formData.get("note") ?? "").trim() || null;

  const existing = await prisma.investorLegacy.findFirst({ where });
  if (existing?.lockedAt) return { error: "Saldo travado — destrave para corrigir." };

  const before = existing ? `${Number(existing.invested)}/${Number(existing.returned)}` : "—";
  const now = new Date();
  if (existing) {
    await prisma.investorLegacy.update({
      where: { id: existing.id },
      data: { invested, returned, since, note, lockedAt: now },
    });
  } else {
    await prisma.investorLegacy.create({
      data: { ...where, invested, returned, since, note, lockedAt: now },
    });
  }

  await logInvestmentAudit({
    entity: "MEMBER",
    entityId: key,
    action: existing ? "UPDATE" : "CREATE",
    summary: `Saldo de abertura do investidor (${key}): aportado $${invested.toLocaleString("en-US")} · devolvido $${returned.toLocaleString("en-US")}${since ? ` · desde ${sinceRaw}` : ""} (antes: ${before})`,
    meta: { invested, returned, since: sinceRaw || null, note },
  });
  revalidatePath(`/pools/investors/${key}`);
  revalidatePath("/portal");
  return { ok: true, message: "Saldo de abertura salvo e travado." };
}

export async function unlockInvestorLegacy(_prev: LegacyFormState, formData: FormData): Promise<LegacyFormState> {
  if (!(await requireAdmin())) return { error: "Apenas ADMIN pode destravar." };
  const key = String(formData.get("entityKey") ?? "").trim();
  const where = entityWhere(key);
  if (!where) return { error: "Entidade inválida." };
  const existing = await prisma.investorLegacy.findFirst({ where });
  if (!existing) return { error: "Nada a destravar." };

  await prisma.investorLegacy.update({ where: { id: existing.id }, data: { lockedAt: null } });
  await logInvestmentAudit({
    entity: "MEMBER",
    entityId: key,
    action: "UPDATE",
    summary: `Saldo de abertura DESTRAVADO para correção (${key}) — valores atuais: aportado $${Number(existing.invested).toLocaleString("en-US")} · devolvido $${Number(existing.returned).toLocaleString("en-US")}`,
  });
  revalidatePath(`/pools/investors/${key}`);
  return { ok: true, message: "Destravado — corrija e salve novamente." };
}
