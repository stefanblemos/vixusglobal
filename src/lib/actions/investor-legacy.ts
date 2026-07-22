"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { logInvestmentAudit } from "@/lib/audit";

/**
 * Lançamentos de projetos ANTERIORES (encerrados) de um investidor — data + tipo + valor +
 * projeto. Entram na linha do tempo do extrato como movimentos normais, então a regra da
 * carteira roda na ordem cronológica correta.
 *
 * É informação reconstituída à mão: exclusiva de ADMIN, TRAVA após salvar e toda alteração
 * é auditada (quem, quando, o que mudou).
 */

export type LegacyFormState = { error?: string; ok?: boolean; message?: string } | undefined;

// NÃO exportar: arquivo "use server" só pode exportar funções async (a UI tem a sua lista).
const LEGACY_KINDS = ["CONTRIBUTION", "DIST_CAPITAL", "DIST_PROFIT"] as const;
type LegacyKind = (typeof LEGACY_KINDS)[number];

type RowInput = { date: string; kind: string; amount: number; label: string | null };

// key no formato do app: "c_<companyId>" | "p_<partyId>"
function entityWhere(key: string): { partyId: string } | { companyId: string } | null {
  const kind = key.slice(0, 1);
  const id = key.slice(2);
  if (!id) return null;
  if (kind === "c") return { companyId: id };
  if (kind === "p") return { partyId: id };
  return null;
}

async function isAdmin(): Promise<boolean> {
  const session = await auth();
  return ((session?.user as { role?: string } | undefined)?.role ?? "") === "ADMIN";
}

export async function saveInvestorLegacy(_prev: LegacyFormState, formData: FormData): Promise<LegacyFormState> {
  if (!(await isAdmin())) return { error: "Apenas ADMIN pode informar o histórico anterior." };

  const key = String(formData.get("entityKey") ?? "").trim();
  const where = entityWhere(key);
  if (!where) return { error: "Entidade inválida." };

  let rows: RowInput[];
  try {
    rows = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { error: "Dados inválidos." };
  }
  const note = String(formData.get("note") ?? "").trim() || null;

  const clean: Array<{ date: Date; kind: LegacyKind; amount: number; label: string | null }> = [];
  for (const [i, r] of rows.entries()) {
    const n = Number(r.amount);
    if (!r.date) return { error: `Linha ${i + 1}: informe a data.` };
    const d = new Date(`${r.date}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return { error: `Linha ${i + 1}: data inválida.` };
    if (!Number.isFinite(n) || n <= 0) return { error: `Linha ${i + 1}: valor deve ser maior que zero.` };
    if (!LEGACY_KINDS.includes(r.kind as LegacyKind)) return { error: `Linha ${i + 1}: tipo inválido.` };
    clean.push({ date: d, kind: r.kind as LegacyKind, amount: Math.round(n * 100) / 100, label: r.label?.trim() || null });
  }
  clean.sort((a, b) => a.date.getTime() - b.date.getTime());

  const existing = await prisma.investorLegacy.findFirst({ where, include: { entries: true } });
  if (existing?.lockedAt) return { error: "Histórico travado — destrave para corrigir." };

  const now = new Date();
  const legacy = existing
    ? await prisma.investorLegacy.update({ where: { id: existing.id }, data: { note, lockedAt: now } })
    : await prisma.investorLegacy.create({ data: { ...where, note, lockedAt: now } });

  await prisma.$transaction([
    prisma.investorLegacyEntry.deleteMany({ where: { legacyId: legacy.id } }),
    ...clean.map((c, i) =>
      prisma.investorLegacyEntry.create({
        data: { legacyId: legacy.id, date: c.date, kind: c.kind, amount: c.amount, label: c.label, sortOrder: i },
      }),
    ),
  ]);

  const totalIn = clean.filter((c) => c.kind === "CONTRIBUTION").reduce((s, c) => s + c.amount, 0);
  const totalOut = clean.filter((c) => c.kind !== "CONTRIBUTION").reduce((s, c) => s + c.amount, 0);
  await logInvestmentAudit({
    entity: "MEMBER",
    entityId: key,
    action: existing ? "UPDATE" : "CREATE",
    summary: `Histórico anterior do investidor (${key}): ${clean.length} lançamento(s) — aportado $${totalIn.toLocaleString("en-US")} · devolvido $${totalOut.toLocaleString("en-US")} (antes: ${existing?.entries.length ?? 0} lançamento(s))`,
    meta: { rows: clean.map((c) => ({ ...c, date: c.date.toISOString().slice(0, 10) })) },
  });
  revalidatePath(`/pools/investors/${key}`);
  revalidatePath("/portal");
  return { ok: true, message: `${clean.length} lançamento(s) salvos e travados.` };
}

export async function unlockInvestorLegacy(_prev: LegacyFormState, formData: FormData): Promise<LegacyFormState> {
  if (!(await isAdmin())) return { error: "Apenas ADMIN pode destravar." };
  const key = String(formData.get("entityKey") ?? "").trim();
  const where = entityWhere(key);
  if (!where) return { error: "Entidade inválida." };
  const existing = await prisma.investorLegacy.findFirst({ where, include: { entries: true } });
  if (!existing) return { error: "Nada a destravar." };

  await prisma.investorLegacy.update({ where: { id: existing.id }, data: { lockedAt: null } });
  await logInvestmentAudit({
    entity: "MEMBER",
    entityId: key,
    action: "UPDATE",
    summary: `Histórico anterior DESTRAVADO para correção (${key}) — ${existing.entries.length} lançamento(s) atuais`,
  });
  revalidatePath(`/pools/investors/${key}`);
  return { ok: true, message: "Destravado — corrija e salve novamente." };
}
