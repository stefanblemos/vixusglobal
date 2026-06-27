import { prisma } from "@/lib/db";

// FONTE ÚNICA de "como a empresa foi tributada no ano". Antes cada tela lia por conta própria —
// quase sempre de TaxReturn.taxTreatment, keyed só por empresa (o IR mais recente valia para TODOS
// os anos) e ignorando CompanyTaxStatus. Resultado: o Reserve podia classificar uma empresa como
// C-corp (21%) e o fechamento como pass-through (30%) no mesmo ano. Aqui a precedência é única:
//   1) CompanyTaxStatus do ANO (o cadastro deliberado por ano)  → vence
//   2) TaxReturn do ANO (o que o contador declarou)             → fallback
//   3) carry-forward: o último conhecido (status, depois IR) de um ano anterior — a forma de
//      tributação é "pegajosa" e raramente muda, então projeta o ano corrente sem IR ainda.
// Quando o ANO tem as duas fontes e elas discordam de CLASSE (corp × pass), marca `diverges` —
// surge como alerta na fila de Review (não escolhe em silêncio).

export type TreatmentClass = "corp" | "pass";
export type TreatmentSource = "status" | "return" | "status-prior" | "return-prior" | null;

export type ResolvedTreatment = {
  treatment: string | null; // a string de tributação efetiva (ex.: "C_CORP", "PARTNERSHIP", "1120-S")
  source: TreatmentSource;
  diverges: boolean; // cadastro e IR do MESMO ano existem e discordam de classe
  statusValue: string | null; // CompanyTaxStatus do ano exato
  returnValue: string | null; // TaxReturn do ano exato
};

const norm = (t: string | null | undefined) => (t ?? "").trim().toUpperCase();

// Classe fiscal que importa para a alíquota: C-corp paga no nível da empresa (corpPct); todo o
// resto (S-corp, partnership, disregarded, sole prop, regimes BR) é pass-through (passPct).
export function treatmentClass(t: string | null | undefined): TreatmentClass | null {
  const s = norm(t);
  if (!s) return null;
  if (/S.?CORP/.test(s) || /1120-?S/.test(s)) return "pass"; // S-corp e 1120-S antes do 1120
  if (/C.?CORP/.test(s) || /\b1120\b/.test(s)) return "corp";
  return "pass"; // não-vazio e não-corp → pass-through (mesmo default do código antigo)
}

export const isCorpTreatment = (t: string | null | undefined) => treatmentClass(t) === "corp";

// Resolução exata do ano (sem carry-forward) — para quem já tem as duas fontes em mãos
// (ex.: o snapshot de fechamento, que olha um único ano).
export function pickExactTreatment(
  statusValue: string | null,
  returnValue: string | null,
): ResolvedTreatment {
  const sv = statusValue && norm(statusValue) ? statusValue : null;
  const rv = returnValue && norm(returnValue) ? returnValue : null;
  const sc = treatmentClass(sv);
  const rc = treatmentClass(rv);
  const diverges = sc != null && rc != null && sc !== rc;
  if (sv != null) return { treatment: sv, source: "status", diverges, statusValue: sv, returnValue: rv };
  if (rv != null) return { treatment: rv, source: "return", diverges, statusValue: sv, returnValue: rv };
  return { treatment: null, source: null, diverges: false, statusValue: sv, returnValue: rv };
}

export type StatusRow = { companyId: string; year: number; taxTreatment: string | null };
export type ReturnRow = {
  companyId: string;
  year: number;
  taxTreatment: string | null;
  createdAt: Date;
};

export type TreatmentResolver = (companyId: string, year: number) => ResolvedTreatment;

// Builder em LOTE: carrega os mapas uma vez e devolve uma função (companyId, year) → resolução.
// Usado pelo Reserve/quarterly e pelo sequence (iteram muitas empresas × anos).
export function buildTreatmentResolver(
  statuses: StatusRow[],
  returns: ReturnRow[],
): TreatmentResolver {
  const statusExact = new Map<string, string>();
  const returnExact = new Map<string, string>();
  const statusYears = new Map<string, number[]>();
  const returnYears = new Map<string, number[]>();

  const push = (m: Map<string, number[]>, id: string, y: number) => {
    const a = m.get(id);
    if (a) a.push(y);
    else m.set(id, [y]);
  };

  for (const s of statuses) {
    if (!norm(s.taxTreatment)) continue;
    statusExact.set(`${s.companyId}:${s.year}`, s.taxTreatment!);
    push(statusYears, s.companyId, s.year);
  }
  // Por (empresa, ano) vence o IR mais recente (createdAt).
  const retLatest = new Map<string, ReturnRow>();
  for (const r of returns) {
    if (!norm(r.taxTreatment)) continue;
    const k = `${r.companyId}:${r.year}`;
    const cur = retLatest.get(k);
    if (!cur || r.createdAt > cur.createdAt) retLatest.set(k, r);
  }
  for (const [k, r] of retLatest) {
    returnExact.set(k, r.taxTreatment!);
    push(returnYears, r.companyId, r.year);
  }
  for (const m of [statusYears, returnYears]) for (const a of m.values()) a.sort((x, y) => y - x);

  const priorOf = (
    exact: Map<string, string>,
    years: Map<string, number[]>,
    companyId: string,
    year: number,
  ): string | null => {
    const ys = years.get(companyId);
    if (!ys) return null;
    const y = ys.find((yy) => yy <= year); // anos em ordem desc → o 1º ≤ year é o mais recente passado
    return y == null ? null : (exact.get(`${companyId}:${y}`) ?? null);
  };

  return (companyId, year) => {
    const exact = pickExactTreatment(
      statusExact.get(`${companyId}:${year}`) ?? null,
      returnExact.get(`${companyId}:${year}`) ?? null,
    );
    if (exact.treatment != null) return exact;
    // carry-forward pegajoso: último status conhecido, depois último IR conhecido.
    const ps = priorOf(statusExact, statusYears, companyId, year);
    if (ps != null)
      return { treatment: ps, source: "status-prior", diverges: false, statusValue: null, returnValue: null };
    const pr = priorOf(returnExact, returnYears, companyId, year);
    if (pr != null)
      return { treatment: pr, source: "return-prior", diverges: false, statusValue: null, returnValue: null };
    return { treatment: null, source: null, diverges: false, statusValue: null, returnValue: null };
  };
}

// Carrega as duas tabelas e devolve o resolver pronto.
export async function loadTreatmentResolver(): Promise<TreatmentResolver> {
  const [statuses, returns] = await Promise.all([
    prisma.companyTaxStatus.findMany({ select: { companyId: true, year: true, taxTreatment: true } }),
    prisma.taxReturn.findMany({
      where: { companyId: { not: null } },
      select: { companyId: true, year: true, taxTreatment: true, createdAt: true },
    }),
  ]);
  return buildTreatmentResolver(
    statuses as StatusRow[],
    returns.filter((r) => r.companyId && r.year != null) as ReturnRow[],
  );
}

export type TreatmentDivergence = {
  companyId: string;
  year: number;
  statusValue: string;
  returnValue: string;
};

// Lista todos os (empresa, ano) onde o cadastro e o IR do MESMO ano discordam de classe — para a
// fila de Review. Carrega as duas tabelas e cruza por (empresa, ano).
export async function loadTreatmentDivergences(): Promise<TreatmentDivergence[]> {
  const [statuses, returns] = await Promise.all([
    prisma.companyTaxStatus.findMany({ select: { companyId: true, year: true, taxTreatment: true } }),
    prisma.taxReturn.findMany({
      where: { companyId: { not: null } },
      select: { companyId: true, year: true, taxTreatment: true, createdAt: true },
    }),
  ]);
  const statusByKey = new Map<string, string>();
  for (const s of statuses) if (norm(s.taxTreatment)) statusByKey.set(`${s.companyId}:${s.year}`, s.taxTreatment!);
  const retLatest = new Map<string, ReturnRow>();
  for (const r of returns) {
    if (!r.companyId || r.year == null || !norm(r.taxTreatment)) continue;
    const k = `${r.companyId}:${r.year}`;
    const cur = retLatest.get(k);
    if (!cur || r.createdAt > cur.createdAt) retLatest.set(k, r as ReturnRow);
  }
  const out: TreatmentDivergence[] = [];
  for (const [k, statusValue] of statusByKey) {
    const r = retLatest.get(k);
    if (!r?.taxTreatment) continue;
    const sc = treatmentClass(statusValue);
    const rc = treatmentClass(r.taxTreatment);
    if (sc != null && rc != null && sc !== rc) {
      const [companyId, year] = k.split(":");
      out.push({ companyId, year: Number(year), statusValue, returnValue: r.taxTreatment });
    }
  }
  return out;
}
