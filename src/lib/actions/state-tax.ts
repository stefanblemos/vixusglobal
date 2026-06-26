"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { extractStateTaxReceipt, type StateTaxReceipt } from "@/lib/tax/receipt-extract";

export type ReceiptReadResult =
  | { ok: true; data: StateTaxReceipt; companyId: string | null }
  | { ok: false; error: string };

// Lê um recibo/notice estadual (PDF) e extrai principal/multa/juros/ano via Claude. Não grava
// nada — só devolve os campos para o formulário confirmar. Tenta casar a empresa pelo nome.
export async function readStateTaxReceipt(formData: FormData): Promise<ReceiptReadResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Selecione um PDF do recibo." };
  if (file.size > 20 * 1024 * 1024) return { ok: false, error: "PDF muito grande (máx. 20MB)." };
  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const data = await extractStateTaxReceipt(base64);

    let companyId: string | null = null;
    const name = data.companyName.trim();
    if (name) {
      const norm = (s: string) => s.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
      const n = norm(name);
      const companies = await prisma.company.findMany({
        where: { jurisdiction: "US" },
        select: { id: true, legalName: true, aliases: true },
      });
      const hit =
        companies.find((c) => norm(c.legalName) === n) ??
        companies.find((c) => norm(c.legalName).includes(n) || n.includes(norm(c.legalName))) ??
        companies.find((c) => c.aliases.some((a) => norm(a) === n || norm(a).includes(n)));
      companyId = hit?.id ?? null;
    }
    return { ok: true, data, companyId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao ler o recibo." };
  }
}

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// Registra (ou atualiza) a apuração estadual de uma empresa/ano. Idempotente por
// (empresa, estado, ano) — re-enviar atualiza os valores em vez de duplicar.
export async function saveStateTaxFiling(formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "");
  const jurisdiction = (String(formData.get("jurisdiction") ?? "FL").trim() || "FL").toUpperCase().slice(0, 4);
  const taxYear = Math.trunc(num(formData.get("taxYear")));
  if (!companyId || !taxYear) return;

  const principal = num(formData.get("principal"));
  const penalty = num(formData.get("penalty"));
  const interest = num(formData.get("interest"));
  const paidRaw = String(formData.get("paidDate") ?? "").trim();
  const paidDate = /^\d{4}-\d{2}-\d{2}$/.test(paidRaw) ? new Date(`${paidRaw}T00:00:00Z`) : null;
  const source = String(formData.get("source") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;

  await prisma.stateTaxFiling.upsert({
    where: { companyId_jurisdiction_taxYear: { companyId, jurisdiction, taxYear } },
    create: { companyId, jurisdiction, taxYear, principal, penalty, interest, paidDate, source, note },
    update: { principal, penalty, interest, paidDate, source, note },
  });
  revalidatePath("/florida");
}

export async function deleteStateTaxFiling(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.stateTaxFiling.delete({ where: { id } });
  revalidatePath("/florida");
}
