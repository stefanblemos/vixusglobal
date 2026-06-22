import { prisma } from "@/lib/db";

// Cruza o General Ledger com o Balance Sheet (saldo final por conta) e o P&L
// (movimento do período por conta), conta a conta. Casa pelo nome normalizado
// (lida com "Pai:Filho" pegando a folha). Não substitui o contador — aponta onde
// o razão e os relatórios não fecham.

export interface CrosscheckRow {
  account: string; // conta no GL
  reportLabel: string; // rótulo no relatório
  reported: number; // valor no BS/P&L
  gl: number; // valor calculado do GL
  diff: number; // reported - gl
  ok: boolean; // bate dentro da tolerância (por magnitude)
}

export interface CrosscheckReport {
  kind: "PROFIT_AND_LOSS" | "BALANCE_SHEET";
  periodLabel: string;
  rows: CrosscheckRow[];
  matched: number;
  mismatched: number;
  unmatchedReport: string[]; // contas do relatório sem conta correspondente no GL
}

export interface GlCrosscheck {
  companyId: string;
  companyName: string;
  year: number | null;
  hasGl: boolean;
  glPeriod: string | null;
  availableYears: number[]; // anos com GL importado (para o seletor)
  pnl: CrosscheckReport | null;
  bs: CrosscheckReport | null;
}

const yearOf = (s: string) => {
  const m = s.match(/(20\d\d)/);
  return m ? Number(m[1]) : null;
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

// Chaves de match: nome completo normalizado + folha (último segmento após ":").
function keysOf(account: string): string[] {
  const full = norm(account);
  const leaf = norm(account.split(":").pop() ?? account);
  return full === leaf ? [full] : [full, leaf];
}

const tolOk = (reported: number, gl: number) => {
  const tol = Math.max(1, 0.01 * Math.abs(reported));
  // Compara por magnitude — as convenções de sinal entre P&L/BS e GL variam.
  return Math.abs(Math.abs(reported) - Math.abs(gl)) <= tol;
};

async function buildReport(
  kind: "PROFIT_AND_LOSS" | "BALANCE_SHEET",
  companyId: string,
  year: number,
  glByKey: Map<string, { account: string; value: number }>,
): Promise<CrosscheckReport | null> {
  const imports = await prisma.qboImport.findMany({
    where: { companyId, reportKind: kind },
    orderBy: { createdAt: "desc" },
    include: { lines: true },
  });
  const imp = imports.find((i) => yearOf(i.periodLabel) === year);
  if (!imp) return null;

  const rows: CrosscheckRow[] = [];
  const unmatchedReport: string[] = [];
  const seen = new Set<string>();

  for (const line of imp.lines) {
    if (line.lineType !== "ACCOUNT" || line.value == null) continue;
    const reported = Number(line.value.toString());
    let hit: { account: string; value: number } | undefined;
    for (const k of keysOf(line.label)) {
      hit = glByKey.get(k);
      if (hit) break;
    }
    if (!hit) {
      unmatchedReport.push(line.label);
      continue;
    }
    if (seen.has(hit.account)) continue;
    seen.add(hit.account);
    rows.push({
      account: hit.account,
      reportLabel: line.label,
      reported,
      gl: hit.value,
      diff: reported - hit.value,
      ok: tolOk(reported, hit.value),
    });
  }

  rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return {
    kind,
    periodLabel: imp.periodLabel,
    rows,
    matched: rows.filter((r) => r.ok).length,
    mismatched: rows.filter((r) => !r.ok).length,
    unmatchedReport,
  };
}

export async function buildGlCrosscheck(
  companyId: string,
  selectedYear?: number | null,
): Promise<GlCrosscheck> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { legalName: true },
  });

  // Todos os GLs da empresa (um por ano) — escolhe o do ano pedido, senão o mais recente.
  const glImports = await prisma.qboImport.findMany({
    where: { companyId, reportKind: "GENERAL_LEDGER" },
    orderBy: { createdAt: "desc" },
  });
  const availableYears = [
    ...new Set(glImports.map((i) => yearOf(i.periodLabel)).filter((y): y is number => y != null)),
  ].sort((a, b) => b - a);
  const glImport =
    (selectedYear != null
      ? glImports.find((i) => yearOf(i.periodLabel) === selectedYear)
      : undefined) ?? glImports[0];

  if (!glImport) {
    return {
      companyId,
      companyName: company?.legalName ?? "—",
      year: null,
      hasGl: false,
      glPeriod: null,
      availableYears,
      pnl: null,
      bs: null,
    };
  }

  const year = yearOf(glImport.periodLabel);

  // Movimento do período por conta (P&L) e saldo final por conta (BS).
  const [txnSums, summaries] = await Promise.all([
    prisma.ledgerTxn.groupBy({
      by: ["account"],
      where: { importId: glImport.id },
      _sum: { amount: true },
    }),
    prisma.glAccountSummary.findMany({ where: { importId: glImport.id } }),
  ]);

  const plByKey = new Map<string, { account: string; value: number }>();
  for (const t of txnSums) {
    const value = t._sum.amount ? Number(t._sum.amount.toString()) : 0;
    for (const k of keysOf(t.account)) plByKey.set(k, { account: t.account, value });
  }
  const bsByKey = new Map<string, { account: string; value: number }>();
  for (const s of summaries) {
    if (s.ending == null) continue;
    const value = Number(s.ending.toString());
    for (const k of keysOf(s.account)) bsByKey.set(k, { account: s.account, value });
  }

  const [pnl, bs] = year
    ? await Promise.all([
        buildReport("PROFIT_AND_LOSS", companyId, year, plByKey),
        buildReport("BALANCE_SHEET", companyId, year, bsByKey),
      ])
    : [null, null];

  return {
    companyId,
    companyName: company?.legalName ?? "—",
    year,
    hasGl: true,
    glPeriod: glImport.periodLabel,
    availableYears,
    pnl,
    bs,
  };
}
