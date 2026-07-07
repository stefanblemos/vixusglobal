import { prisma } from "@/lib/db";
import { pnlTotals } from "@/lib/qbo/pnl";
import { buildClosingSequence, acronymOf, type SeqNode } from "@/lib/closing/sequence";
import { buildAssetRegister } from "@/lib/assets/depreciation";
import { buildDepreciationReconciliation } from "@/lib/assets/reconcile-dep";
import { bookDepFromLines, trustBookDepAdjustment, macrsAppliedToBase } from "@/lib/assets/book-tax-dep";
import { edgesFromOwnerships } from "@/lib/ownership/effective";
import { loadTreatmentResolver, isCorpTreatment } from "@/lib/tax/treatment";
import { periodMonths } from "@/lib/qbo/period";
import { loadClosedResolver } from "@/lib/companies/closed";
import { yearRates } from "@/lib/tax/rates";

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
  nonDeductible: number; // add-backs do M-1 detectados do P&L (inclui IR federal — nunca dedutível)
  nonDeductibleItems: { label: string; amount: number }[]; // detalhe do add-back ("o que foi o ajuste")
  stateTaxAddBack: number; // add-back do estadual pago no ano (principal + multa) — do controle /florida ou do P&L
  stateTaxInterest: number; // juros do estadual pago no ano — dedutíveis, NÃO somados (só p/ nota)
  stateTaxSource: "florida" | null; // add-back estadual (pagamento do ano anterior) — do controle /florida
  statePnlUnfiled: number; // P&L tem "State Taxes" mas sem StateTaxFiling → gap a cadastrar (não somado à base)
  stateEstimate: number; // estadual DO ANO estimado (FL 5,5% − isenção), a pagar em Y+1 — dedutível (só C-corp)
  stateEstInterest: number; // juros estimados sobre o diferimento do estadual do ano — dedutível
  depAdj: number; // ajuste de depreciação na base: 0 quando confia no livro; −MACRS quando o livro não tem
  bookDep: number; // depreciação no P&L (livro) do ano
  macrsDep: number; // depreciação MACRS do ano (app) — dos ativos cadastrados
  macrsApplied: boolean; // true = livro sem dep e MACRS aplicada na base; false = confia no livro
  depCatchUp: number | null; // catch-up acumulado (MACRS acum − IR acum até o ano), da Conferência; null se sem ativos
  k1In: number; // K-1 recebido das investidas
  k1From: { fromKey: string; fromName: string; fromAcronym: string; amount: number }[]; // origem do K-1
  taxable: number;
  tax: number; // 0 p/ pass-through (repassa)
  disregardedInto: string | null; // se é entidade desconsiderada: acrônimo da dona onde o resultado foi dobrado (taxable/tax = 0 aqui)
  foldedIn: { name: string; acronym: string; book: number }[]; // filhos desconsiderados dobrados NESTA (a dona)
  passesTo: { name: string; acronym: string; pct: number }[];
  tier: number;
  inCycle: boolean; // posse circular → o K-1 cruzado é aproximado (a base pode não fechar)
  pnlImportId: string | null; // import do P&L do ano (fonte clicável)
  bsImportId: string | null; // import do Balance Sheet do ano (fonte clicável)
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
  excludedClosed: string[]; // empresas encerradas antes do ano (IR final já declarado) — não entram
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

type Line = { lineType: string; label: string; value: unknown; sectionPath?: string[] };
type AddBack = { label: string; amount: number };
// Despesas do P&L que NÃO são despesa de verdade para o imposto e precisam voltar à base (Schedule
// M-1). O caso mais grave: o QBO lança o PAGAMENTO de IR federal (e estadual) como despesa — isso
// derruba o lucro para um valor irreal. O IR federal nunca é dedutível → volta sempre. O estadual é
// dedutível no federal, então é tratado à parte (`stateTaxFromPnl`): o controle /florida tem
// prioridade e, se não houver, usa-se esta linha — evitando dupla contagem. Retorna o DETALHE
// (label + valor) para a tela deixar claro "o que foi o ajuste".
function taxAddBacksFromPnl(lines: Line[]): { total: number; items: AddBack[]; stateTaxFromPnl: number } {
  const items: AddBack[] = [];
  let stateTaxFromPnl = 0;
  for (const l of lines) {
    if (l.lineType !== "ACCOUNT" || l.value == null) continue;
    const v = Math.abs(Number(l.value));
    if (v < 0.005) continue;
    const n = l.label.toLowerCase();
    // Contas FILHAS (sub-contas de controle interno) herdam o conceito do PAI: uma sub-conta dentro
    // de "Meals" conta como refeição mesmo que o nome dela não diga "meal" (ex.: "Per Diem"). Só usado
    // p/ refeição/entretenimento (onde o QBO tem muita sub-conta); imposto federal/estadual segue só
    // pelo rótulo (preciso). `hay` = rótulo + cadeia de pais.
    const hay = (n + " " + (l.sectionPath ?? []).join(" ")).toLowerCase();
    // Folha (não é IR): inclui FUTA/SUTA e os formulários 940/941 — antes escapavam e "Federal 940
    // Tax" entrava como add-back de IR federal.
    const payroll = /payroll|unemploy|\bfica\b|social security|medicare|\bfui\b|\bsui\b|\bfuta\b|\bsuta\b|withhold|\b94[01]\b/.test(n);
    // Imposto de RENDA de outra esfera que NÃO é o IR federal da empresa: estrangeiro (creditável ou
    // dedutível via FTC) e municipal/cidade (dedutível como SALT). Não entram no add-back federal —
    // ficam como despesa deduzida (correto). Antes "Foreign income tax"/"Local income tax" entravam.
    const foreignOrLocal = /foreign|\blocal\b|\bcity\b|municipal/.test(n);
    // imposto de renda ESTADUAL (não folha/vendas/imóvel) — dedutível no federal; tratado à parte.
    if (!payroll && /\bstate\b/.test(n) && /tax|income/.test(n) && !/sales|use tax|property|tangible/.test(n)) {
      stateTaxFromPnl = Math.round((stateTaxFromPnl + v) * 100) / 100;
      continue;
    }
    // imposto de renda FEDERAL — nunca dedutível (Schedule M-1, linha 2). Casa "Federal Taxes",
    // "Federal Income Tax", "US income tax", "income tax — federal" (mas não folha/estrangeiro/local).
    if (!payroll && !foreignOrLocal && /federal/.test(n) && /tax|income/.test(n)) items.push({ label: l.label, amount: v });
    else if (!payroll && !foreignOrLocal && /income tax/.test(n) && !/\bstate\b/.test(n)) items.push({ label: l.label, amount: v });
    else if (/\bmeal/.test(hay)) items.push({ label: l.label, amount: Math.round(v * 50) / 100 }); // 50% — pega sub-contas de refeição pelo pai
    // Entretenimento PURO (sem "meal" no rótulo/pai — este já caiu no ramo acima): 100% não dedutível
    // desde a TCJA (2018). "Meals & Entertainment" combinado fica no ramo de meals (50%, conservador).
    else if (/entertain/.test(hay)) items.push({ label: l.label, amount: v });
    else if (/penalt|fine|late fee/.test(n)) items.push({ label: l.label, amount: v });
    else if (/life insurance/.test(n)) items.push({ label: l.label, amount: v });
    else if (/political|club dues|lobby/.test(n)) items.push({ label: l.label, amount: v });
  }
  const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  return { total, items, stateTaxFromPnl };
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const yearOf = (s: string | null | undefined) => Number((String(s ?? "").match(/(?:19|20)\d\d/) ?? [])[0] ?? 0);

// Estimativa do imposto estadual DO ANO (Florida F-1120): 5,5% sobre a base apurada menos a isenção
// anual de $50k, só para C-corp (FL não tributa renda de pass-through). Como ainda não foi pago (cai
// no ano seguinte, quando o contador fecha o IR), estima-se juros de ~8% a.a. (~1 ano de diferimento,
// taxa underpayment IRS/FL). Principal e juros são dedutíveis no federal → reduzem a base de 21%.
// A alíquota e a isenção de Florida vêm de yearRates (Tax settings) — fonte única, não constante.
const STATE_INTEREST = 0.08;

// opts.throughMonths (3/6/9) = modo PERÍODO (estimado até o trimestre): usa o P&L YTD do período e a
// MACRS proporcional (× throughMonths/12) trocando a depreciação do livro. Default 12 = ano cheio.
export async function buildTaxPreview(
  year: number,
  opts?: { throughMonths?: number },
): Promise<TaxPreview> {
  const throughMonths = opts?.throughMonths ?? 12;
  const isPeriod = throughMonths < 12;
  const asOf = new Date(Date.UTC(year, 11, 31));
  const [seq, assetReg, ownerships, pnlImports, stateFilings, companies, resolveTreatment, closedResolver, yr] = await Promise.all([
    buildClosingSequence(year),
    buildAssetRegister(year),
    prisma.ownership.findMany({
      select: { ownerCompanyId: true, ownerPartyId: true, ownedCompanyId: true, ownedPartyId: true, percentage: true, effectiveDate: true, endDate: true },
    }),
    prisma.qboImport.findMany({
      // Pré-filtro por ano: yearOf() extrai o ano de dentro do próprio periodLabel, logo todo
      // label com yearOf===year contém String(year). O filtro JS (yearOf) segue sendo autoridade
      // — isto só evita carregar as linhas de todos os outros anos. Comportamento idêntico.
      where: { reportKind: "PROFIT_AND_LOSS", periodLabel: { contains: String(year) } },
      orderBy: { createdAt: "desc" },
      select: { id: true, companyId: true, periodLabel: true, lines: { select: { lineType: true, label: true, value: true, sectionPath: true } } },
    }),
    prisma.stateTaxFiling.findMany({
      select: { companyId: true, principal: true, penalty: true, interest: true, paidDate: true },
    }),
    prisma.company.findMany({
      select: { id: true, legalName: true, baseCurrency: true, monitored: true, relationship: true, controlsTax: true, closedDate: true, status: true, disregardedIntoId: true },
    }),
    loadTreatmentResolver(),
    loadClosedResolver(),
    yearRates(year),
  ]);
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const isUsd = (id: string) => (companyById.get(id)?.baseCurrency ?? "USD") === "USD";
  // Empresa ENCERRADA antes do ano Y → some do preview/reserve (fonte única lib/companies/closed).
  const isClosedBeforeYear = (id: string) => closedResolver.isClosedBeforeYear(id, year);

  // P&L por empresa, AWARE DO PERÍODO: pega o YTD (começa em janeiro) que cobre até `throughMonths`
  // (de maior cobertura ≤ alvo; em empate, o upload mais recente). No ano cheio prefere o Jan–Dez.
  // Assim a fonte é única por período — não pega um YTD parcial achando que é o ano, nem vice-versa.
  const startEnd = (label: string) => {
    const pm = periodMonths(label);
    return pm ? { start: pm.start, end: pm.end } : { start: 1, end: 12 }; // sem período legível → assume anual
  };
  const yearPnls = new Map<string, typeof pnlImports>(); // já vêm mais-recente-primeiro
  for (const imp of pnlImports) {
    if (!imp.companyId || yearOf(imp.periodLabel) !== year) continue;
    (yearPnls.get(imp.companyId) ?? yearPnls.set(imp.companyId, []).get(imp.companyId)!).push(imp);
  }
  const pnlByCompany = new Map<string, Line[]>();
  const pnlImportIdByCompany = new Map<string, string>();
  for (const [cid, imps] of yearPnls) {
    const ytd = imps.filter((i) => {
      const { start, end } = startEnd(i.periodLabel);
      return start === 1 && end <= throughMonths;
    });
    ytd.sort((a, b) => startEnd(b.periodLabel).end - startEnd(a.periodLabel).end); // maior cobertura primeiro (estável p/ recência)
    const best = ytd[0];
    if (best) {
      pnlByCompany.set(cid, best.lines);
      pnlImportIdByCompany.set(cid, best.id);
    }
  }
  // Balance Sheet mais recente do ANO por empresa — só o id (para o link da fonte).
  const bsImports = await prisma.qboImport.findMany({
    where: { reportKind: "BALANCE_SHEET", periodLabel: { contains: String(year) } },
    orderBy: { createdAt: "desc" },
    select: { id: true, companyId: true, periodLabel: true },
  });
  const bsImportIdByCompany = new Map<string, string>();
  for (const imp of bsImports) {
    if (!imp.companyId || yearOf(imp.periodLabel) !== year) continue;
    if (!bsImportIdByCompany.has(imp.companyId)) bsImportIdByCompany.set(imp.companyId, imp.id);
  }

  const macrsByCompany = new Map(assetReg.byCompany.map((b) => [b.companyId, b.yearDep])); // MACRS efetiva (referência)
  const realDepByCompany = new Map(assetReg.byCompany.map((b) => [b.companyId, b.realDep])); // livro real onde houver, senão MACRS

  // Conferência (catch-up acumulado) só para empresas COM ativos cadastrados — fonte única da
  // comparação livro × MACRS. Pega a diferença ACUMULADA até o ano (MACRS acum − IR acum).
  const assetCompanyIds = [...new Set(assetReg.byCompany.map((b) => b.companyId))];
  // Um único register MACRS-puro (todas as empresas) reusado por todas as reconciliações — antes
  // cada buildDepreciationReconciliation reconstruía o register da empresa (N+1). O schedule é
  // vitalício, então o pureRegister injetado dá os mesmos números que a reconstrução por empresa.
  const currentYear = new Date().getUTCFullYear();
  const pureRegister = await buildAssetRegister(currentYear, undefined, { pureMacrs: true });
  const recons = await Promise.all(
    assetCompanyIds.map((id) => buildDepreciationReconciliation(id, { pureRegister }).catch(() => null)),
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
    if (isPeriod && f.paidDate.getUTCMonth() + 1 > throughMonths) continue; // só o pago até o período
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
  // (C) Empresa ENCERRADA antes do ano (IR final já declarado / closedDate): some do cálculo.
  const excludedClosed = seqNodes
    .filter((n) => n.kind === "company" && isUsd(n.id) && isClosedBeforeYear(n.id))
    .map((n) => n.name);
  const nodes: SeqNode[] = seqNodes.filter((n) => n.kind === "person" || (isUsd(n.id) && !isClosedBeforeYear(n.id)));

  // (B) Inclui empresas elegíveis (USD, monitoradas, do grupo/que controlamos) com P&L ou imposto
  // estadual do ano que ficaram FORA da sequência (sem ownership/IR) — senão quem deve pagar some.
  const present = new Set(nodes.filter((n) => n.kind === "company").map((n) => n.id));
  const eligible = (c: { monitored: boolean; relationship: string; controlsTax: boolean; baseCurrency: string }) =>
    c.monitored && c.baseCurrency === "USD" && (c.relationship === "GROUP_MEMBER" || c.controlsTax);
  for (const id of new Set([...pnlByCompany.keys(), ...stateByCompany.keys()])) {
    if (present.has(id)) continue;
    const c = companyById.get(id);
    if (!c || !eligible(c)) continue;
    if (isClosedBeforeYear(id)) { excludedClosed.push(c.legalName); continue; } // encerrada → nota, não entra
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
  const blank = { bookNet: 0, nonDed: 0, nonDedItems: [] as AddBack[], stateAddBack: 0, stateInterest: 0, stateSource: null as "florida" | null, statePnlUnfiled: 0, depAdj: 0, bookDep: 0, macrsDep: 0, macrsApplied: false, depCatchUp: null as number | null, hasPnl: false };
  const self = new Map<string, typeof blank>();
  const missingPnl: string[] = [];
  for (const n of nodes) {
    if (n.kind !== "company") { self.set(n.key, { ...blank }); continue; }
    const lines = pnlByCompany.get(n.id);
    if (!lines) { self.set(n.key, { ...blank }); missingPnl.push(n.name); continue; }
    const bookNet = pnlTotals(lines).netIncome ?? 0;
    const ded = taxAddBacksFromPnl(lines);
    const nonDed = ded.total;
    // Estadual: o controle /florida (datado: principal+multa, juros à parte) tem prioridade. Sem ele,
    // usa-se a linha de imposto estadual do próprio P&L (fallback) — sem duplicar.
    // O controle /florida já faz o add-back do estadual PAGO no ano (que é o do ano anterior — os
    // livros lançam essa despesa quando pagam). A linha "State Taxes" do P&L é justamente esse
    // pagamento de Y-1, então NÃO entra na base de Y (não a somamos). O estadual DE Y (ainda não
    // pago) é estimado à parte, mais abaixo.
    const st = stateByCompany.get(n.id);
    const stateAddBack = st ? r2(st.addBack) : 0;
    const stateInterest = st ? r2(st.interest) : 0;
    const stateSource: "florida" | null = st ? "florida" : null;
    // GAP visível: o P&L tem "State Taxes" (despesa deduzida) mas NÃO há StateTaxFiling cadastrado
    // em /florida. Não somamos à base (o split principal/multa/juros vem do recibo, e a linha mistura
    // anos — não chutamos). Só sinalizamos para o usuário cadastrar. Antes ficava invisível.
    const statePnlUnfiled = !st && ded.stateTaxFromPnl > 0.005 ? r2(ded.stateTaxFromPnl) : 0;
    const bookDep = bookDepFromLines(lines);
    const hasAssets = macrsByCompany.has(n.id);
    let macrsDep: number, realDep: number, macrsApplied: boolean, depAdj: number;
    if (isPeriod) {
      // ESTIMADO do período: a depreciação é a MACRS do ano PROPORCIONAL (× throughMonths/12),
      // TROCANDO a do livro (no meio do ano o livro normalmente não a lançou).
      const annualMacrs = hasAssets ? r2(macrsByCompany.get(n.id)!) : 0;
      const prorated = r2((annualMacrs * throughMonths) / 12);
      macrsDep = prorated;
      realDep = prorated;
      macrsApplied = hasAssets && prorated > 0;
      depAdj = r2(bookDep - prorated); // base passa a usar a MACRS proporcional
    } else {
      // ANO CHEIO: CONFIA no livro; só aplica a depreciação REAL quando o P&L não tem nenhuma.
      macrsDep = hasAssets ? r2(macrsByCompany.get(n.id)!) : 0; // MACRS (referência/conferência)
      realDep = hasAssets ? r2(realDepByCompany.get(n.id)!) : 0; // livro registrado onde houver, senão MACRS
      macrsApplied = macrsAppliedToBase(bookDep, realDep, hasAssets);
      depAdj = trustBookDepAdjustment(bookDep, realDep, hasAssets);
    }
    const depCatchUp = reconByCompany.get(n.id)?.catchUp ?? null;
    self.set(n.key, { bookNet: r2(bookNet), nonDed, nonDedItems: ded.items, stateAddBack, stateInterest, stateSource, statePnlUnfiled, depAdj, bookDep: r2(bookDep), macrsDep, macrsApplied, depCatchUp, hasPnl: true });
  }

  const nodeByKey = new Map(nodes.map((n) => [n.key, n]));

  // ENTIDADE DESCONSIDERADA (disregarded): dobra a base própria do filho na DONA e zera o filho. O filho
  // não declara IR próprio (é consolidado no da dona), então: (a) sua base entra no `self` da dona ANTES
  // do K-1, (b) o filho fica com base 0 → taxable/tax/K-1 = 0 (não conta duas vezes, não repassa K-1
  // fantasma). Fonte única: Company.disregardedIntoId. Só dobra se a dona também está no preview.
  const disregardedInto = new Map<string, string>(); // childKey → acrônimo da dona
  const foldedInByKey = new Map<string, { name: string; acronym: string; book: number }[]>(); // parentKey → filhos
  for (const n of nodes) {
    if (n.kind !== "company") continue;
    const pid = companyById.get(n.id)?.disregardedIntoId;
    if (!pid) continue;
    const parentKey = ck(pid);
    const parent = self.get(parentKey);
    if (!parent) continue; // dona fora do preview (encerrada/não-USD/sem P&L) → não dobra, segue normal
    const child = self.get(n.key)!;
    parent.bookNet = r2(parent.bookNet + child.bookNet);
    parent.nonDed = r2(parent.nonDed + child.nonDed);
    parent.nonDedItems = [...parent.nonDedItems, ...child.nonDedItems.map((i) => ({ label: `${n.acronym}: ${i.label}`, amount: i.amount }))];
    parent.stateAddBack = r2(parent.stateAddBack + child.stateAddBack);
    parent.stateInterest = r2(parent.stateInterest + child.stateInterest);
    parent.statePnlUnfiled = r2(parent.statePnlUnfiled + child.statePnlUnfiled);
    parent.depAdj = r2(parent.depAdj + child.depAdj);
    parent.bookDep = r2(parent.bookDep + child.bookDep);
    parent.macrsDep = r2(parent.macrsDep + child.macrsDep);
    disregardedInto.set(n.key, nodeByKey.get(parentKey)?.acronym ?? "");
    const arr = foldedInByKey.get(parentKey) ?? [];
    arr.push({ name: n.name, acronym: n.acronym, book: child.bookNet });
    foldedInByKey.set(parentKey, arr);
    self.set(n.key, { ...blank, hasPnl: false }); // filho zerado (base já dobrada na dona)
  }

  // K-1 acumulado de baixo para cima. k1FromByKey guarda a ORIGEM (quem repassou e quanto) — para o
  // drill-down "das empresas formadoras de K-1 até os owners".
  const k1In = new Map<string, number>();
  const k1FromByKey = new Map<string, { fromKey: string; amount: number }[]>();
  const taxableByKey = new Map<string, number>();
  for (const n of nodes) {
    if (disregardedInto.has(n.key)) { taxableByKey.set(n.key, 0); continue; } // desconsiderada: já dobrada na dona, não repassa
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
    const baseBeforeState = r2(s.bookNet + s.nonDed + s.stateAddBack + s.depAdj + (k1In.get(n.key) ?? 0));
    // Estadual DO ANO (a estimar, ainda não pago): só C-corp, sobre base positiva, menos a isenção FL.
    // Principal + juros são dedutíveis no federal → reduzem a base de 21%.
    let stateEstimate = 0, stateEstInterest = 0;
    if (t === "C-corp" && baseBeforeState > 0) {
      stateEstimate = r2(Math.max(0, baseBeforeState - yr.flExemption) * (yr.flPct / 100));
      stateEstInterest = r2(stateEstimate * STATE_INTEREST);
    }
    const taxable = r2(baseBeforeState - stateEstimate - stateEstInterest);
    // Alíquota federal C-corp = fonte única yr.corpPct (Tax settings); antes era 0.21 hardcoded e
    // divergia do reserve se a taxa fosse alterada.
    const tax = t === "C-corp" ? r2(Math.max(0, taxable) * (yr.corpPct / 100)) : t === "PF" ? federalPF(taxable) : 0;
    return {
      key: n.key, kind: n.kind, id: n.id, name: n.name, acronym: n.acronym, entityType: t,
      hasPnl: s.hasPnl, bookNet: s.bookNet, nonDeductible: s.nonDed, nonDeductibleItems: s.nonDedItems,
      stateTaxAddBack: s.stateAddBack, stateTaxInterest: s.stateInterest, stateTaxSource: s.stateSource,
      statePnlUnfiled: s.statePnlUnfiled,
      stateEstimate, stateEstInterest,
      depAdj: s.depAdj, bookDep: s.bookDep, macrsDep: s.macrsDep, macrsApplied: s.macrsApplied, depCatchUp: s.depCatchUp,
      k1In: r2(k1In.get(n.key) ?? 0),
      k1From: (k1FromByKey.get(n.key) ?? [])
        .map((f) => ({ fromKey: f.fromKey, fromName: nodeByKey.get(f.fromKey)?.name ?? "—", fromAcronym: nodeByKey.get(f.fromKey)?.acronym ?? "?", amount: r2(f.amount) }))
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
      taxable, tax, disregardedInto: disregardedInto.get(n.key) ?? null, foldedIn: foldedInByKey.get(n.key) ?? [],
      passesTo: n.passesTo, tier: n.tier, inCycle: n.inCycle,
      pnlImportId: n.kind === "company" ? (pnlImportIdByCompany.get(n.id) ?? null) : null,
      bsImportId: n.kind === "company" ? (bsImportIdByCompany.get(n.id) ?? null) : null,
    };
  });

  const corpTax = r2(rows.filter((r) => r.entityType === "C-corp").reduce((a, r) => a + r.tax, 0));
  const pfTax = r2(rows.filter((r) => r.entityType === "PF").reduce((a, r) => a + r.tax, 0));
  return { year, years: seq.years.length ? seq.years : [year], rows, groupTax: r2(corpTax + pfTax), corpTax, pfTax, missingPnl, excludedNonUsd, excludedClosed };
}
