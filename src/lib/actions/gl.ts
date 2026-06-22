"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseGeneralLedger } from "@/lib/qbo/general-ledger";
import { importGeneralLedger } from "@/lib/qbo/gl-import";
import { matchCompany } from "@/lib/qbo/match";
import { gunzipB64 } from "@/lib/util/gzip-server";

export interface GlAnalyzeResult {
  companyName: string;
  periodLabel: string;
  transactions: number;
  accounts: string[];
  matchedCompanyId: string | null;
  companies: { id: string; legalName: string }[];
  sameYearPeriod: string | null; // GL já importado do MESMO ano (será somado, não substituído)
}

const yearOf = (s: string | null | undefined) => {
  const m = (s ?? "").match(/(20\d\d)/);
  return m ? Number(m[0]) : null;
};

export async function analyzeGl(gz: string): Promise<GlAnalyzeResult> {
  const gl = parseGeneralLedger(gunzipB64(gz));
  const companies = await prisma.company.findMany({
    select: { id: true, legalName: true, tradeName: true, aliases: true },
    orderBy: { legalName: "asc" },
  });
  const matchedCompanyId = matchCompany(gl.companyName, companies);

  // Só avisa se já houver GL do MESMO ano (esse será somado/atualizado). Outros anos
  // coexistem (complementares) — nada é apagado.
  const glYear =
    yearOf(gl.periodLabel) ??
    yearOf(gl.transactions.find((t) => yearOf(t.date))?.date ?? null);
  const existing = matchedCompanyId
    ? await prisma.qboImport.findMany({
        where: { companyId: matchedCompanyId, reportKind: "GENERAL_LEDGER" },
        select: { periodLabel: true },
      })
    : [];
  const sameYear = glYear != null ? existing.find((i) => yearOf(i.periodLabel) === glYear) : undefined;

  return {
    companyName: gl.companyName,
    periodLabel: gl.periodLabel,
    transactions: gl.transactions.length,
    accounts: gl.accounts,
    matchedCompanyId,
    companies: companies.map((c) => ({ id: c.id, legalName: c.legalName })),
    sameYearPeriod: sameYear?.periodLabel ?? null,
  };
}

export async function saveGl(input: {
  gz: string;
  companyId: string | null;
  fileName: string;
}): Promise<void> {
  if (!input.companyId) {
    // O GL é transacional e fica preso à empresa — exige vínculo explícito.
    throw new Error("Selecione a empresa antes de salvar o General Ledger.");
  }
  await importGeneralLedger(prisma, gunzipB64(input.gz), input.fileName, { companyId: input.companyId });
  revalidatePath("/import");
  revalidatePath("/ledger");
  revalidatePath("/closing");
  redirect(`/ledger?company=${input.companyId}`);
}
