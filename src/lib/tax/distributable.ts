import { prisma } from "@/lib/db";
import { loadTreatmentResolver, isCorpTreatment } from "@/lib/tax/treatment";
import { isEffectiveAt, asOfYearEnd } from "@/lib/ownership/effective";
import { effectiveFiguresOf } from "@/lib/ir/figures";

// BASE DISTRIBUÍVEL (renda já tributada) — quanto dá para mover de uma pass-through ao DESTINO FINAL
// sem novo imposto. Fonte = IR (não os livros): a `capital account (end)` da última declaração ≤ ano
// é a BASE fiscal distribuível (distribuição até a base = devolução de renda já tributada, tax-free;
// acima vira ganho). Valor BRUTO (o imposto já foi pago no ano da renda; distribuir não gera imposto
// novo). Atribuição SEM dupla contagem: a base de cada pass-through vai só aos donos diretos que são
// FINAIS (pessoa ou C-corp); dono pass-through é conduíte (a capital account dele já rola o de baixo).
// Guarda: pass-through sem IR (ou sem a figura) → NÃO calcula, sinaliza.

const num = (v: unknown) => Number((v as { toString(): string } | null)?.toString() ?? 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
// Figuras do IR para a "base distribuível" (a conta que acumula renda já tributada):
//   • Partnership (1065): Partners'/Members' capital account (Schedule L / M-2).
//   • S-Corp (1120-S): AAA — Accumulated Adjustments Account (Schedule M-2); fallback retained earnings.
// As duas são o análogo: renda que passou no K-1 e ainda não foi distribuída.
const CAPITAL_END = /(partner|member).*capital.*end|capital account.*end|accumulated adjustments.*(end|balance)|\baaa\b.*(end|balance)|retained earnings.*(end|close)/i;
const CAPITAL_END_BARE = /accumulated adjustments account|retained earnings/i; // fallback S-corp sem "end"
const CAPITAL_BEGIN = /(partner|member).*capital.*(begin|beginning)|capital account.*(begin|beginning)|accumulated adjustments.*(begin|beginning)|retained earnings.*(begin|beginning)/i;
const INCOME = /ordinary business income/i;
const GUARANTEED = /guaranteed payment/i;
const DISTRIBUTIONS = /distribution.*(cash|marketable|property)|withdrawals and distributions|distributions.*shareholders?/i;

// Ano-a-ano da conta de capital (uma linha por IR): mostra COMO se chegou na base atual, para conferir.
export interface CapYear {
  year: number;
  returnId: string; // id do TaxReturn (para linkar o PDF e conferir na fonte)
  hasPdf: boolean; // tem PDF do IR guardado (para o link "ver IR")
  capBegin: number | null; // capital (início) — valor fiel ao IR (com sinal)
  income: number | null; // ordinary business income (loss) do ano
  guaranteed: number | null; // guaranteed payments
  distributions: number | null; // distribuições do ano
  capEnd: number | null; // capital (fim) — a base acumulada até este ano
  capEndComputed: boolean; // true = capEnd CALCULADO (rolagem início/anterior + renda − dist), não lido do IR
  isFinal: boolean; // IR "final" (ex.: 1120-S final na conversão S-corp→partnership) — vem ANTES do continuador
}

// O que uma pass-through possui (para o drill-down do holding: ver o que há "dentro" da capital account).
export interface Holding {
  companyId: string;
  name: string;
  pct: number; // % que a origem detém desta investida
  capitalAccount: number | null; // capital account da investida (null = sem figura no IR)
  amount: number | null; // capitalAccount × pct
}

export interface DistSource {
  companyId: string;
  name: string;
  pct: number;
  capitalAccount: number; // base fiscal (end) da declaração usada
  irYear: number; // ano da declaração de onde veio a base (as-of)
  baseComputed: boolean; // a base usada foi CALCULADA (o IR mais recente não trouxe a figura)
  amount: number; // capitalAccount × pct
  yearDetail: CapYear[]; // ano-a-ano da capital account (todos os IRs da empresa ≤ ano)
  holdings: Holding[]; // investidas desta origem (composição do holding) — vazio se não é holding
}

// Valor "preso" numa C-corp que a pessoa possui: economicamente é dela, mas sair da C-corp é
// DIVIDENDO TRIBUTÁVEL (não devolução de base) → NÃO entra na base distribuível tax-free.
export interface TrappedCorp {
  companyId: string;
  name: string;
  pct: number; // % da pessoa na C-corp
  corpTotal: number; // base distribuível total DENTRO da C-corp
  share: number; // corpTotal × pct (o que seria da pessoa, mas sai como dividendo)
}

export interface DistOwner {
  key: string;
  kind: "pessoa" | "C-corp";
  name: string;
  total: number;
  sources: DistSource[]; // pass-throughs de origem (detalhe)
  trappedInCorp: TrappedCorp[]; // C-corps que a pessoa possui (valor preso lá) — vazio p/ C-corp
}

export interface DistMissing {
  companyId: string;
  name: string;
  reason: "sem-ir" | "ir-sem-figura"; // sem declaração ≤ ano, ou tem mas sem a figura capital account
}

export interface DistributableReport {
  year: number;
  owners: DistOwner[];
  missing: DistMissing[];
  total: number;
}

export async function buildDistributableReport(year: number): Promise<DistributableReport> {
  const asOf = asOfYearEnd(year);
  const [companies, parties, owns, resolve] = await Promise.all([
    prisma.company.findMany({ select: { id: true, legalName: true } }),
    prisma.party.findMany({ where: { kind: "PERSON" }, select: { id: true, name: true } }),
    prisma.ownership.findMany({
      select: { ownerPartyId: true, ownerCompanyId: true, ownedCompanyId: true, percentage: true, effectiveDate: true, endDate: true },
    }),
    loadTreatmentResolver(),
  ]);
  const nameCo = new Map(companies.map((c) => [c.id, c.legalName]));
  const nameP = new Map(parties.map((p) => [p.id, p.name]));
  const isCorp = (id: string) => isCorpTreatment(resolve(id, year).treatment);

  // Ano-a-ano da capital account por empresa (todos os IRs ≤ ano). A base usada é o capEnd da mais
  // recente. `hasIr` = tem alguma declaração ≤ ano (p/ distinguir "sem IR" de "IR sem a figura").
  // select explícito: NÃO carrega o blob `pdf` (pesado) — só o que a extração/rastreio precisa.
  const returns = await prisma.taxReturn.findMany({
    where: { companyId: { not: null } },
    select: { id: true, companyId: true, year: true, figures: true, manualFigures: true, pdfSize: true, isFinalReturn: true },
    orderBy: { year: "asc" },
  });
  const hasIr = new Set<string>();
  const detailByCo = new Map<string, CapYear[]>();
  // Fiel ao IR: preserva o SINAL (um ano de prejuízo mostra a renda negativa, como na declaração).
  const pickFig = (figs: { label?: string; value?: number | null }[], re: RegExp, exclude?: RegExp) => {
    const f = figs.find((x) => re.test(x.label ?? "") && !(exclude && exclude.test(x.label ?? "")));
    return f?.value != null ? num(f.value) : null;
  };
  for (const ret of returns) {
    if (!ret.companyId || ret.year == null || ret.year > year) continue;
    hasIr.add(ret.companyId);
    const figs = (effectiveFiguresOf(ret) ?? []) as { label?: string; value?: number | null }[];
    const row: CapYear = {
      year: ret.year,
      returnId: ret.id,
      hasPdf: (ret.pdfSize ?? 0) > 0,
      capBegin: pickFig(figs, CAPITAL_BEGIN),
      income: pickFig(figs, INCOME, /apportioned|other partnership|estates/i),
      guaranteed: pickFig(figs, GUARANTEED, /health/i),
      distributions: pickFig(figs, DISTRIBUTIONS),
      capEnd: pickFig(figs, CAPITAL_END) ?? pickFig(figs, CAPITAL_END_BARE),
      capEndComputed: false,
      isFinal: ret.isFinalReturn,
    };
    (detailByCo.get(ret.companyId) ?? detailByCo.set(ret.companyId, []).get(ret.companyId)!).push(row);
  }
  // FILL calculado: onde o IR não trouxe o capEnd, rola do último conhecido: prior + renda − distribuições
  // (marcado como calculado, ≠ do IR). Anos ANTES do 1º capEnd conhecido não têm âncora → ficam null.
  for (const detail of detailByCo.values()) {
    // Ano asc; no MESMO ano, o IR "final" vem antes do continuador (não-final) → o capEnd going-forward
    // é o do continuador (o 1065 na conversão S-corp→partnership), pego como o mais recente com capEnd.
    detail.sort((a, b) => a.year - b.year || Number(b.isFinal) - Number(a.isFinal));
    let running: number | null = null;
    for (const d of detail) {
      if (d.capEnd != null) running = d.capEnd;
      else if (running != null) {
        running = r2(running + (d.income ?? 0) - (d.distributions ?? 0));
        d.capEnd = running;
        d.capEndComputed = true;
      }
    }
  }
  // Base = capEnd do ANO MAIS RECENTE que tenha capEnd (lido ou calculado).
  const capByCo = new Map<string, { val: number; year: number; computed: boolean; detail: CapYear[] }>();
  for (const [id, detail] of detailByCo) {
    const withEnd = detail.filter((d) => d.capEnd != null);
    if (withEnd.length) {
      const latest = withEnd[withEnd.length - 1];
      capByCo.set(id, { val: latest.capEnd!, year: latest.year, computed: latest.capEndComputed, detail });
    }
  }

  // Holdings: o que cada empresa POSSUI (investidas vigentes) + capital account delas — para o
  // drill-down do holding (ver a composição de dentro).
  const holdingsByCo = new Map<string, Holding[]>();
  for (const o of owns) {
    if (!o.ownerCompanyId || !o.ownedCompanyId || !isEffectiveAt(o, asOf)) continue;
    const invCap = capByCo.get(o.ownedCompanyId);
    const pct = Number(o.percentage);
    const h: Holding = {
      companyId: o.ownedCompanyId,
      name: nameCo.get(o.ownedCompanyId) ?? "—",
      pct,
      capitalAccount: invCap?.val ?? null,
      amount: invCap ? r2((invCap.val * pct) / 100) : null,
    };
    (holdingsByCo.get(o.ownerCompanyId) ?? holdingsByCo.set(o.ownerCompanyId, []).get(o.ownerCompanyId)!).push(h);
  }

  const pool = new Map<string, DistOwner>();
  const missing: DistMissing[] = [];
  const addTo = (key: string, name: string, kind: "pessoa" | "C-corp", src: DistSource) => {
    const g = pool.get(key) ?? { key, kind, name, total: 0, sources: [], trappedInCorp: [] };
    g.total = r2(g.total + src.amount);
    g.sources.push(src);
    pool.set(key, g);
  };

  for (const e of companies) {
    if (isCorp(e.id)) continue; // C-corp não é origem (pagadora final, para nela)
    const ownersOfE = owns.filter((o) => o.ownedCompanyId === e.id && isEffectiveAt(o, asOf));
    if (!ownersOfE.length) continue; // sem ownership → fora
    const cap = capByCo.get(e.id);
    if (!cap) {
      missing.push({ companyId: e.id, name: nameCo.get(e.id) ?? "—", reason: hasIr.has(e.id) ? "ir-sem-figura" : "sem-ir" });
      continue;
    }
    for (const o of ownersOfE) {
      const pct = Number(o.percentage);
      const src: DistSource = {
        companyId: e.id, name: nameCo.get(e.id) ?? "—", pct,
        capitalAccount: cap.val, irYear: cap.year, baseComputed: cap.computed,
        amount: r2((Math.max(0, cap.val) * pct) / 100),
        yearDetail: cap.detail,
        holdings: (holdingsByCo.get(e.id) ?? []).sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)),
      };
      if (o.ownerPartyId) addTo(`P:${o.ownerPartyId}`, nameP.get(o.ownerPartyId) ?? "?", "pessoa", src);
      else if (o.ownerCompanyId && isCorp(o.ownerCompanyId)) addTo(`C:${o.ownerCompanyId}`, nameCo.get(o.ownerCompanyId) ?? "?", "C-corp", src);
      // dono pass-through → conduíte, pula (a base dele já rola esta)
    }
  }

  // Nota "preso na C-corp": para cada PESSOA que possui uma C-corp direto, o valor lá dentro
  // (base da C-corp × %) sai como DIVIDENDO tributável — não entra na base tax-free dela. Inclui
  // pessoas que só possuem C-corp (aparecem com $0 distribuível + a nota, para não sumirem).
  const corpTotalById = new Map<string, number>();
  for (const g of pool.values()) if (g.kind === "C-corp") corpTotalById.set(g.key.slice(2), g.total);
  for (const o of owns) {
    if (!o.ownerPartyId || !o.ownedCompanyId || !isEffectiveAt(o, asOf) || !isCorp(o.ownedCompanyId)) continue;
    const corpTotal = corpTotalById.get(o.ownedCompanyId) ?? 0;
    if (corpTotal <= 0.005) continue;
    const key = `P:${o.ownerPartyId}`;
    const g = pool.get(key) ?? { key, kind: "pessoa" as const, name: nameP.get(o.ownerPartyId) ?? "?", total: 0, sources: [], trappedInCorp: [] };
    const pct = Number(o.percentage);
    g.trappedInCorp.push({
      companyId: o.ownedCompanyId, name: nameCo.get(o.ownedCompanyId) ?? "—",
      pct, corpTotal, share: r2((corpTotal * pct) / 100),
    });
    pool.set(key, g);
  }
  for (const g of pool.values()) g.trappedInCorp.sort((a, b) => b.share - a.share);

  const owners = [...pool.values()]
    .map((o) => ({ ...o, sources: o.sources.sort((a, b) => b.amount - a.amount) }))
    .sort((a, b) => b.total - a.total);
  return {
    year,
    owners,
    missing: missing.sort((a, b) => a.name.localeCompare(b.name)),
    total: r2(owners.reduce((s, o) => s + o.total, 0)),
  };
}
