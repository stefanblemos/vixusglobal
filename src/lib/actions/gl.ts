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

// Normaliza a data de abertura (vem como "2025-09-16", "September 16, 2025", ou só "2025")
// para ISO YYYY-MM-DD, comparável direto com as datas (ISO) do GL. Ano sozinho → 01/01.
function formationToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  if (/^\s*\d{4}\s*$/.test(s)) return `${s.trim()}-01-01`;
  // Datas com barra (DD/MM/YYYY PT-BR ou MM/DD/YYYY US): desambigua quando um número > 12.
  const slash = s.match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const [day, month] = a > 12 ? [a, b] : b > 12 ? [b, a] : [b, a]; // ambíguo → assume MM/DD (US)
    const p = (n: number) => String(n).padStart(2, "0");
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${slash[3]}-${p(month)}-${p(day)}`;
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t); // string sem fuso → meia-noite local; getters locais devolvem a data escrita
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface GlPreFormation {
  hasFormation: boolean;
  formationDate: string | null; // como cadastrado (para exibir)
  count: number; // nº de lançamentos com data < abertura e valor ≠ 0
  examples: { date: string; account: string; amount: number }[];
  earliestDate: string | null; // data mais antiga do GL (ajuda a julgar a abertura)
}

// Checagem (no import): lançamentos do GL ANTERIORES à abertura da empresa, com valor ≠ 0.
// Roda contra a empresa selecionada no preview; não bloqueia o save, só alerta.
export async function glPreFormation(gz: string, companyId: string): Promise<GlPreFormation> {
  const gl = parseGeneralLedger(gunzipB64(gz));
  const company = companyId
    ? await prisma.company.findUnique({ where: { id: companyId }, select: { formationDate: true } })
    : null;
  const formation = formationToIso(company?.formationDate);

  const dated = gl.transactions.filter((t) => /^\d{4}-\d{2}-\d{2}/.test(t.date));
  const earliestDate = dated.reduce<string | null>(
    (m, t) => (m == null || t.date < m ? t.date : m),
    null,
  );

  if (!formation) {
    return {
      hasFormation: false,
      formationDate: company?.formationDate ?? null,
      count: 0,
      examples: [],
      earliestDate,
    };
  }

  const before = dated
    .filter((t) => t.date < formation && Math.abs(Number(t.amount ?? 0)) > 0.005)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    hasFormation: true,
    formationDate: company?.formationDate ?? null,
    count: before.length,
    examples: before.slice(0, 5).map((t) => ({
      date: t.date,
      account: t.account,
      amount: Number(t.amount ?? 0),
    })),
    earliestDate,
  };
}

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
  const res = await importGeneralLedger(prisma, gunzipB64(input.gz), input.fileName, {
    companyId: input.companyId,
  });
  revalidatePath("/import");
  revalidatePath("/ledger");
  revalidatePath("/closing");
  redirect(`/ledger?company=${input.companyId}&added=${res.added}&skipped=${res.skipped}`);
}
