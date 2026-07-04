import { prisma } from "@/lib/db";
import { buildTaxPreview } from "@/lib/tax/preview";
import { effectiveFiguresOf, type IrFigure } from "@/lib/ir/figures";

// Auditoria QBO × IR: confronta o que o app CALCULA (tax preview, a partir do QBO) com o que o
// contador DECLAROU (as figuras do IR). Cada métrica bate, diverge, é divergência esperada (holding:
// o IR consolida K-1 no lucro, o livro standalone não) ou não tem IR para comparar. É a missão do
// Vixus — conferir o contador — feita pelo app, sem dado novo. Só leitura.

export type ReconStatus = "match" | "diverge" | "expected" | "no-ir";
export type RowSeverity = "diverge" | "warn" | "no-ir" | "no-qbo" | "ok";

export interface ReconMetric {
  key: string;
  label: string;
  preview: number | null;
  ir: number | null;
  diff: number | null; // preview − IR
  status: ReconStatus;
  note?: string;
}

export interface IrReconRow {
  companyId: string;
  name: string;
  acronym: string;
  entityType: string;
  hasQbo: boolean;
  hasIr: boolean;
  metrics: ReconMetric[];
  flags: string[];
  severity: RowSeverity;
}

export interface IrReconciliation {
  year: number;
  years: number[];
  rows: IrReconRow[];
  summary: { total: number; ok: number; diverging: number; warn: number; noIr: number; noQbo: number };
}

// Tolerância: bate se |prev − IR| ≤ max($1.000, 8% do IR). Ajustes book→tax pequenos não viram flag.
const withinTol = (a: number, b: number) => Math.abs(a - b) <= Math.max(1000, 0.08 * Math.abs(b));

// Figura do IR comparável com a BASE TRIBUTÁVEL do preview, por tipo de entidade: C-corp declara
// "taxable income" (1120 linha 30); pass-through não tem taxable income no nível — o que passa no
// K-1 é o "ordinary business income" (1065/1120-S). Sem essas, cai no lucro por livro (NET_INCOME).
// (Antes só se olhava TAXABLE_INCOME → toda pass-through ficava sem conferência, mesmo tendo o dado.)
export function baselineFig(entityType: string, figs: IrFigure[]): { key: string; value: number } | null {
  const get = (k: string) => {
    const f = figs.find((f) => f.key === k && f.value != null);
    return f ? { key: k, value: Number(f.value) } : null;
  };
  if (entityType === "C-corp") return get("TAXABLE_INCOME") ?? get("NET_INCOME");
  return get("ORDINARY_INCOME") ?? get("NET_INCOME");
}
const FIG_LABEL: Record<string, string> = {
  TAXABLE_INCOME: "taxable income",
  ORDINARY_INCOME: "ordinary income",
  NET_INCOME: "lucro por livro",
};

// Selo de confiança de UM número (base tributável) contra o IR — para badgear o preview/reserve sem
// recomputar a reconciliação inteira. "match" = confere com o IR · "diverge" = IR existe e diverge ·
// "none" = sem IR do ano para conferir (só estimativa). Só para empresas com P&L.
export type IrConfidence = "match" | "diverge" | "none";
export async function irTaxableConfidence(
  year: number,
  rows: { id: string; kind: string; entityType: string; taxable: number; hasPnl: boolean }[],
): Promise<Record<string, IrConfidence>> {
  const rets = await prisma.taxReturn.findMany({
    where: { companyId: { not: null }, year },
    select: { companyId: true, figures: true, manualFigures: true },
  });
  const figsByCo = new Map<string, IrFigure[]>();
  for (const r of rets) if (r.companyId) figsByCo.set(r.companyId, effectiveFiguresOf(r));
  const out: Record<string, IrConfidence> = {};
  for (const row of rows) {
    if (row.kind !== "company" || !row.hasPnl) continue;
    const figs = figsByCo.get(row.id);
    const base = figs ? baselineFig(row.entityType, figs) : null;
    out[row.id] = base == null ? "none" : withinTol(row.taxable, base.value) ? "match" : "diverge";
  }
  return out;
}

export async function buildIrReconciliation(year: number): Promise<IrReconciliation> {
  const preview = await buildTaxPreview(year);
  const rets = await prisma.taxReturn.findMany({
    where: { companyId: { not: null }, year },
    select: { companyId: true, figures: true, manualFigures: true, company: { select: { legalName: true } } },
  });
  const irByCo = new Map<string, IrFigure[]>();
  const irCoName = new Map<string, string>();
  for (const r of rets) {
    if (!r.companyId) continue;
    irByCo.set(r.companyId, effectiveFiguresOf(r));
    irCoName.set(r.companyId, r.company?.legalName ?? r.companyId);
  }
  const irFig = (cid: string, key: string): number | null => {
    const f = irByCo.get(cid)?.find((f) => f.key === key && f.value != null);
    return f ? Number(f.value) : null;
  };

  const rows: IrReconRow[] = [];
  const seen = new Set<string>();

  for (const r of preview.rows) {
    if (r.kind !== "company") continue;
    seen.add(r.id);
    const hasIr = irByCo.has(r.id);
    const hasQbo = r.hasPnl;
    const metrics: ReconMetric[] = [];
    const flags: string[] = [];

    const cmp = (
      key: string,
      label: string,
      prev: number | null,
      ir: number | null,
      opts?: { expected?: boolean; note?: string },
    ) => {
      let status: ReconStatus;
      if (ir == null || prev == null) status = "no-ir";
      else if (withinTol(prev, ir)) status = "match";
      else if (opts?.expected) status = "expected";
      else status = "diverge";
      metrics.push({
        key,
        label,
        preview: prev,
        ir,
        diff: prev != null && ir != null ? Math.round(prev - ir) : null,
        status,
        note: status === "expected" ? opts?.note : undefined,
      });
    };

    const isHolding = r.k1In !== 0; // recebe K-1 → o IR consolida no lucro; o livro standalone não
    const base = hasIr ? baselineFig(r.entityType, irByCo.get(r.id)!) : null;
    cmp(
      "taxable",
      base ? `Base tributável (vs ${FIG_LABEL[base.key] ?? base.key})` : "Base tributável",
      hasQbo ? r.taxable : null,
      base?.value ?? null,
    );
    cmp("addbacks", "Add-backs (M-1)", hasQbo ? r.nonDeductible : null, irFig(r.id, "NON_DEDUCTIBLE"));
    cmp("depreciation", "Depreciação (livro)", hasQbo ? r.bookDep : null, irFig(r.id, "DEPRECIATION"));
    cmp("net", "Lucro líquido (livro)", hasQbo ? r.bookNet : null, irFig(r.id, "NET_INCOME"), {
      expected: isHolding,
      note: "holding: o IR consolida o K-1 das investidas; o livro standalone não — compare a base tributável",
    });
    // Estadual só faz sentido comparar em C-corp (FL tributa só corp; pass-through não paga no nível).
    const irState = irFig(r.id, "STATE_TAX");
    if (r.entityType === "C-corp")
      cmp("state", "Estadual (est. do ano × IR)", hasQbo ? r.stateEstimate || r.stateTaxAddBack || 0 : null, irState);
    else if (irState != null && Math.abs(irState) > 5000)
      // Pass-through com STATE_TAX alto no IR: o preview (0) está certo — é a figura do IR que chama
      // atenção (FL não tributa pass-through; pode ser outro estado, retenção, ou figura mal extraída).
      flags.push(`IR mostra ${Math.round(irState).toLocaleString("en-US")} de estadual numa pass-through — conferir a figura (FL não tributa pass-through no nível)`);

    const irDep = irFig(r.id, "DEPRECIATION");
    if (irDep != null && irDep > 500 && hasQbo && r.bookDep === 0 && r.macrsDep === 0)
      flags.push(`IR tem ${Math.round(irDep).toLocaleString("en-US")} de depreciação, mas a empresa não tem ativos cadastrados`);
    if (r.statePnlUnfiled > 0)
      flags.push(`${Math.round(r.statePnlUnfiled).toLocaleString("en-US")} em State Taxes no P&L sem cadastro em Florida`);

    let severity: RowSeverity;
    if (!hasQbo) severity = "no-qbo";
    else if (!hasIr) severity = "no-ir";
    else if (metrics.some((mt) => mt.status === "diverge")) severity = "diverge";
    else if (flags.length) severity = "warn";
    else severity = "ok";

    rows.push({ companyId: r.id, name: r.name, acronym: r.acronym, entityType: r.entityType, hasQbo, hasIr, metrics, flags, severity });
  }

  // IR presente mas empresa fora do preview (sem QBO do ano, encerrada ou não-USD).
  for (const cid of irByCo.keys()) {
    if (seen.has(cid)) continue;
    rows.push({
      companyId: cid,
      name: irCoName.get(cid) ?? cid,
      acronym: "",
      entityType: "—",
      hasQbo: false,
      hasIr: true,
      metrics: [],
      flags: ["IR presente, mas fora do preview (sem P&L do ano, encerrada, ou moeda estrangeira)"],
      severity: "no-qbo",
    });
  }

  const rank: Record<RowSeverity, number> = { diverge: 0, warn: 1, "no-ir": 2, "no-qbo": 3, ok: 4 };
  rows.sort((a, b) => rank[a.severity] - rank[b.severity] || a.name.localeCompare(b.name));

  const summary = {
    total: rows.length,
    ok: rows.filter((r) => r.severity === "ok").length,
    diverging: rows.filter((r) => r.severity === "diverge").length,
    warn: rows.filter((r) => r.severity === "warn").length,
    noIr: rows.filter((r) => r.severity === "no-ir").length,
    noQbo: rows.filter((r) => r.severity === "no-qbo").length,
  };

  return { year, years: preview.years, rows, summary };
}
