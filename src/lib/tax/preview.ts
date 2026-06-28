import { prisma } from "@/lib/db";
import { pnlTotals } from "@/lib/qbo/pnl";
import { buildClosingSequence, acronymOf, type SeqNode } from "@/lib/closing/sequence";
import { buildAssetRegister } from "@/lib/assets/depreciation";
import { buildDepreciationReconciliation } from "@/lib/assets/reconcile-dep";
import { bookDepFromLines, trustBookDepAdjustment, macrsAppliedToBase } from "@/lib/assets/book-tax-dep";
import { edgesFromOwnerships } from "@/lib/ownership/effective";
import { loadTreatmentResolver, isCorpTreatment } from "@/lib/tax/treatment";

// Tax preview: estima o IR final de cada entidade do grupo a partir do QBO já importado.
// Por entidade: lucro líquido (P&L) + despesas não dedutíveis (M-1) ± ajuste de depreciação
// (livro → MACRS) + K-1 recebido = base tributável → imposto. C-corp paga 21% federal; pass-through
// repassa a base via K-1 (não paga no nível); PF aplica as faixas federais (MFJ 2024, só federal).
// É um estimador de controle — confirmar com o contador.

export type EntityType = "C-corp" | "Pass-through" | "PF";

export interface TaxPreviewRow {
  key: string;
  kind: "company" | "person";
  id: string;
  name: string;
  acronym: string;
  entityType: EntityType;
  hasPnl: boolean;
  bookNet: number; // lucro líquido do P&L (0 p/ pessoa)
  nonDeductible: number; // add-backs do M-1 detectados do P&L
  stateTaxAddBack: number; // add-back do estadual pago no ano (principal + multa) — do controle /florida
  stateTaxInterest: number; // juros do estadual pago no ano — dedutíveis, NÃO somados (só p/ nota)
  depAdj: number; // ajuste de depreciação na base: 0 quando confia no livro; −MACRS quando o livro não tem
  bookDep: number; // depreciação no P&L (livro) do ano
  macrsDep: number; // depreciação MACRS do ano (app) — dos ativos cadastrados
  macrsApplied: boolean; // true = livro sem dep e MACRS aplicada na base; false = confia no livro
  depCatchUp: number | null; // catch-up acumulado (MACRS acum − IR acum até o ano), da Conferência; null se sem ativos
  k1In: number; // K-1 recebido das investidas
  k1From: { fromKey: string; fromName: string; fromAcronym: string; amount: number }[]; // origem do K-1
  taxable: number;
  tax: number; // 0 p/ pass-through (repassa)
  passesTo: { name: string; acronym: string; pct: number }[];
  tier: number;
  inCycle: boolean; // posse circular → o K-1 cruzado é aproximado (a base pode não fechar)
}

export interface TaxPreview {
  year: number;
  years: number[];
  rows: TaxPreviewRow[];
  groupTax: number;
  corpTax: number;
  pfTax: number;
  missingPnl: string[]; // empresas sem P&L do ano
  excludedNonUsd: string[]; // empresas em moeda estrangeira fora do cálculo federal US (tributadas no país)
}

// Faixas federais MFJ 2024 + dedução padrão (estimativa simplificada, só federal).
const MFJ_2024: [number, number][] = [
  [23200, 0.1], [94300, 0.12], [201050, 0.22], [383900, 0.24], [487450, 0.32], [731200, 0.35], [Infinity, 0.37],
];
const STD_MFJ = 29200;
function federalPF(taxable: number): number {
  let ti = Math.max(0, taxable - STD_MFJ);
  let tax = 0, prev = 0;
  for (const [cap, rate] of MFJ_2024) {
    if (ti <= prev) break;
    tax += (Math.min(ti, cap) - prev) * rate;
    prev = cap;
  }
  return Math.round(tax * 100) / 100;
}

type Line = { lineType: string; label: string; value: unknown };
function nonDeductibleFromPnl(lines: Line[]): number {
  let total = 0;
  for (const l of lines) {
    if (l.lineType !== "ACCOUNT" || l.value == null) continue;
    const v = Math.abs(Number(l.value));
    const n = l.label.toLowerCase();
    if (/\bmeal/.test(n)) total += v * 0.5; // 50% das refeições
    else if (/penalt|fine|late fee/.test(n)) total += v; // multas/penalidades
    else if (/life insurance/.test(n)) total += v; // seguro de vida de oficial
    else if (/federal income tax/.test(n)) total += v; // imposto federal
    else if (/political|club dues|lobby/.test(n)) total += v; // contrib. política/clube
  }
  return Math.round(total * 100) / 100;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const yearOf = (s: string | null | undefined) => Number((String(s ?? "").match(/(?:19|20)\d\d/) ?? [])[0] ?? 0);

export async function buildTaxPreview(year: number): Promise<TaxPreview> {
  const asOf = new Date(Date.UTC(year, 11, 31));
  const [seq, assetReg, ownerships, pnlImports, stateFilings, companies, resolveTreatment] = await Promise.all([
    buildClosingSequence(year),
    buildAssetRegister(year),
    prisma.ownership.findMany({
      select: { ownerCompanyId: true, ownerPartyId: true, ownedCompanyId: true, ownedPartyId: true, percentage: true, effectiveDate: true, endDate: true },
    }),
    prisma.qboImport.findMany({
      where: { reportKind: "PROFIT_AND_LOSS" },
      orderBy: { createdAt: "desc" },
      select: { id: true, companyId: true, periodLabel: true, lines: { select: { lineType: true, label: true, value: true } } },
    }),
    prisma.stateTaxFiling.findMany({
      select: { companyId: true, principal: true, penalty: true, interest: true, paidDate: true },
    }),
    prisma.company.findMany({
      select: { id: true, legalName: true, baseCurrency: true, monitored: true, relationship: true, controlsTax: true },
    }),
    loadTreatmentResolver(),
  ]);
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const isUsd = (id: string) => (companyById.get(id)?.baseCurrency ?? "USD") === "USD";

  // P&L mais recente do ANO por empresa.
  const pnlByCompany = new Map<string, Line[]>();
  for (const imp of pnlImports) {
    if (!imp.companyId || yearOf(imp.periodLabel) !== year) continue;
    if (!pnlByCompany.has(imp.companyId)) pnlByCompany.set(imp.companyId, imp.lines);
  }

  const macrsByCompany = new Map(assetReg.byCompany.map((b) => [b.companyId, b.yearDep]));

  // Conferência (catch-up acumulado) só para empresas COM ativos cadastrados — fonte única da
  // comparação livro × MACRS. Pega a diferença ACUMULADA até o ano (MACRS acum − IR acum).
  const assetCompanyIds = [...new Set(assetReg.byCompany.map((b) => b.companyId))];
  const recons = await Promise.all(
    assetCompanyIds.map((id) => buildDepreciationReconciliation(id).catch(() => null)),
  );
  const reconByCompany = new Map<string, { macrsAccum: number; irAccum: number; catchUp: number }>();
  for (const rec of recons) {
    if (!rec) continue;
    const row = rec.rows.find((r) => r.year === year);
    if (row) reconByCompany.set(rec.companyId, { macrsAccum: row.macrsAccum, irAccum: row.irAccum, catchUp: row.accumDiff });
  }

  // Imposto estadual PAGO no ano (do controle /florida): no ano do pagamento, os livros lançaram a
  // despesa do estadual do ano anterior — então o principal (já deduzido antes) + a multa (não
  // dedutível) voltam como add-back no M-1. Os juros são dedutíveis p/ C-corp → ficam de fora.
  const stateByCompany = new Map<string, { addBack: number; interest: number }>();
  for (const f of stateFilings) {
    if (!f.paidDate || f.paidDate.getUTCFullYear() !== year) continue;
    const principal = Number(f.principal.toString());
    const penalty = Number(f.penalty.toString());
    const interest = Number(f.interest.toString());
    const g = stateByCompany.get(f.companyId) ?? { addBack: 0, interest: 0 };
    g.addBack += principal + penalty;
    g.interest += interest;
    stateByCompany.set(f.companyId, g);
  }

  // Donos por possuída (para repassar K-1): ownedKey → [{ownerKey, pct}].
  const ck = (id: string) => `c:${id}`;
  const pk = (id: string) => `p:${id}`;
  const recipientsByOwned = new Map<string, { ownerKey: string; pct: number }[]>();
  for (const e of edgesFromOwnerships(ownerships, asOf)) {
    if (e.ownedType !== "company") continue;
    const ownedKey = ck(e.ownedId);
    const ownerKey = e.ownerType === "party" ? pk(e.ownerId) : ck(e.ownerId);
    (recipientsByOwned.get(ownedKey) ?? recipientsByOwned.set(ownedKey, []).get(ownedKey)!).push({ ownerKey, pct: e.percentage });
  }

  // (A) Moeda: o preview é IMPOSTO FEDERAL US — só entidades em USD. Empresas em moeda estrangeira
  // (PT/EUR, BR/BRL) são tributadas no próprio país; ficam fora e são listadas à parte (igual ao reserve).
  const seqNodes = seq.tiers.flat(); // ordem ascendente de tier (investidas antes das investidoras)
  const excludedNonUsd = seqNodes.filter((n) => n.kind === "company" && !isUsd(n.id)).map((n) => n.name);
  const nodes: SeqNode[] = seqNodes.filter((n) => n.kind === "person" || isUsd(n.id));

  // (B) Inclui empresas elegíveis (USD, monitoradas, do grupo/que controlamos) com P&L ou imposto
  // estadual do ano que ficaram FORA da sequência (sem ownership/IR) — senão quem deve pagar some.
  const present = new Set(nodes.filter((n) => n.kind === "company").map((n) => n.id));
  const eligible = (c: { monitored: boolean; relationship: string; controlsTax: boolean; baseCurrency: string }) =>
    c.monitored && c.baseCurrency === "USD" && (c.relationship === "GROUP_MEMBER" || c.controlsTax);
  for (const id of new Set([...pnlByCompany.keys(), ...stateByCompany.keys()])) {
    if (present.has(id)) continue;
    const c = companyById.get(id);
    if (!c || !eligible(c)) continue;
    present.add(id);
    nodes.push({
      key: ck(id), kind: "company", id, name: c.legalName, acronym: acronymOf(c.legalName, "company"),
      form: null, finalPayer: isCorpTreatment(resolveTreatment(id, year).treatment),
      passesTo: [], tier: 1, deps: [], status: "ready", done: false, outOfOrder: [], inCycle: false,
    });
  }

  const typeOf = (n: SeqNode): EntityType =>
    n.kind === "person" ? "PF" : n.finalPayer ? "C-corp" : "Pass-through";

  // Base própria de cada entidade.
  const blank = { bookNet: 0, nonDed: 0, stateAddBack: 0, stateInterest: 0, depAdj: 0, bookDep: 0, macrsDep: 0, macrsApplied: false, depCatchUp: null as number | null, hasPnl: false };
  const self = new Map<string, typeof blank>();
  const missingPnl: string[] = [];
  for (const n of nodes) {
    if (n.kind !== "company") { self.set(n.key, { ...blank }); continue; }
    const lines = pnlByCompany.get(n.id);
    if (!lines) { self.set(n.key, { ...blank }); missingPnl.push(n.name); continue; }
    const bookNet = pnlTotals(lines).netIncome ?? 0;
    const nonDed = nonDeductibleFromPnl(lines);
    // Add-back do estadual pago no ano (o P&L lançou essa despesa, então reverte principal+multa).
    const st = stateByCompany.get(n.id);
    const stateAddBack = st ? r2(st.addBack) : 0;
    const stateInterest = st ? r2(st.interest) : 0;
    // Depreciação: CONFIA no livro. Se o P&L já tem depreciação, a base usa o lucro como está
    // (ajuste 0) — o que diverge da MACRS vira só FLAG (catch-up da Conferência), não imposto.
    // A MACRS do app só entra na base quando o livro NÃO tem depreciação nenhuma (preenche a lacuna).
    const bookDep = bookDepFromLines(lines);
    const hasAssets = macrsByCompany.has(n.id);
    const macrsDep = hasAssets ? r2(macrsByCompany.get(n.id)!) : 0;
    const macrsApplied = macrsAppliedToBase(bookDep, macrsDep, hasAssets);
    const depAdj = trustBookDepAdjustment(bookDep, macrsDep, hasAssets);
    const depCatchUp = reconByCompany.get(n.id)?.catchUp ?? null;
    self.set(n.key, { bookNet: r2(bookNet), nonDed, stateAddBack, stateInterest, depAdj, bookDep: r2(bookDep), macrsDep, macrsApplied, depCatchUp, hasPnl: true });
  }

  // K-1 acumulado de baixo para cima. k1FromByKey guarda a ORIGEM (quem repassou e quanto) — para o
  // drill-down "das empresas formadoras de K-1 até os owners".
  const nodeByKey = new Map(nodes.map((n) => [n.key, n]));
  const k1In = new Map<string, number>();
  const k1FromByKey = new Map<string, { fromKey: string; amount: number }[]>();
  const taxableByKey = new Map<string, number>();
  for (const n of nodes) {
    const s = self.get(n.key)!;
    const taxable = r2(s.bookNet + s.nonDed + s.stateAddBack + s.depAdj + (k1In.get(n.key) ?? 0));
    taxableByKey.set(n.key, taxable);
    const t = typeOf(n);
    if (t === "Pass-through") {
      for (const rcpt of recipientsByOwned.get(n.key) ?? []) {
        const amt = r2(taxable * (rcpt.pct / 100));
        k1In.set(rcpt.ownerKey, r2((k1In.get(rcpt.ownerKey) ?? 0) + amt));
        const arr = k1FromByKey.get(rcpt.ownerKey) ?? [];
        arr.push({ fromKey: n.key, amount: amt });
        k1FromByKey.set(rcpt.ownerKey, arr);
      }
    }
  }

  const rows: TaxPreviewRow[] = nodes.map((n) => {
    const s = self.get(n.key)!;
    const t = typeOf(n);
    // Base recomputada a partir do k1In FINAL → a linha sempre fecha (book + add-backs + dep + K-1).
    // Num DAG é idêntica à acumulada; só difere num ciclo (sinalizado por inCycle).
    const taxable = r2(s.bookNet + s.nonDed + s.stateAddBack + s.depAdj + (k1In.get(n.key) ?? 0));
    const tax = t === "C-corp" ? r2(Math.max(0, taxable) * 0.21) : t === "PF" ? federalPF(taxable) : 0;
    return {
      key: n.key, kind: n.kind, id: n.id, name: n.name, acronym: n.acronym, entityType: t,
      hasPnl: s.hasPnl, bookNet: s.bookNet, nonDeductible: s.nonDed,
      stateTaxAddBack: s.stateAddBack, stateTaxInterest: s.stateInterest,
      depAdj: s.depAdj, bookDep: s.bookDep, macrsDep: s.macrsDep, macrsApplied: s.macrsApplied, depCatchUp: s.depCatchUp,
      k1In: r2(k1In.get(n.key) ?? 0),
      k1From: (k1FromByKey.get(n.key) ?? [])
        .map((f) => ({ fromKey: f.fromKey, fromName: nodeByKey.get(f.fromKey)?.name ?? "—", fromAcronym: nodeByKey.get(f.fromKey)?.acronym ?? "?", amount: r2(f.amount) }))
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
      taxable, tax, passesTo: n.passesTo, tier: n.tier, inCycle: n.inCycle,
    };
  });

  const corpTax = r2(rows.filter((r) => r.entityType === "C-corp").reduce((a, r) => a + r.tax, 0));
  const pfTax = r2(rows.filter((r) => r.entityType === "PF").reduce((a, r) => a + r.tax, 0));
  return { year, years: seq.years.length ? seq.years : [year], rows, groupTax: r2(corpTax + pfTax), corpTax, pfTax, missingPnl, excludedNonUsd };
}
