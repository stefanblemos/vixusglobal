// Pre-flight de fechamento do mês (#64, Leva 1) — checklist automático ANTES de publicar
// o report mensal. Regra de ouro do review 3-chapéus: o sistema deriva tudo do ledger,
// então a proteção é um checklist que pega dado esquecido (o caso do netReceived do PH-3:
// casa vendida sem o líquido lançado → número errado ao investidor). BLOCKER trava a
// publicação (a menos que o operador confirme "publicar mesmo assim"); WARNING só alerta.
import { prisma } from "@/lib/db";
import type { Lang } from "@/lib/pools/i18n";

export type PreflightSeverity = "BLOCKER" | "WARNING";
export type PreflightItem = {
  severity: PreflightSeverity;
  title: string;
  detail: string;
  href?: string;
};
export type PreflightResult = {
  items: PreflightItem[];
  blockers: number;
  warnings: number;
};

const n = (v: unknown): number => (v == null ? 0 : Number(v));

const T = {
  pt: {
    soldNoPrice: (h: string) => ({ t: `${h}: venda sem preço`, d: "A casa tem data de venda mas o preço de venda (soldPrice) está vazio — o report mostraria a venda por US$0." }),
    soldNoNet: (h: string) => ({ t: `${h}: venda sem líquido recebido`, d: "Data e preço de venda lançados, mas o líquido em conta (netReceived) está vazio. Sem ele o extrato e a TIR do investidor saem errados." }),
    soldNoPayoff: (h: string) => ({ t: `${h}: venda com financiamento sem payoff`, d: "A casa foi vendida e tem loan vinculado, mas a quitação do banco (payoff) não foi lançada — o caixa distribuível fica superestimado." }),
    soldNoCost: (h: string) => ({ t: `${h}: venda sem custo real`, d: "Casa vendida no mês sem custo real de lote/obra informado — o lucro seria calculado pelo planejado, não pelo realizado." }),
    noBaseline: () => ({ t: "Sem baseline de cronograma", d: "O pool não tem baseline congelado da simulação — a seção de prazos (previsto × realizado) do report fica vazia." }),
    monthOpen: (label: string) => ({ t: `Mês ainda em curso (${label})`, d: "O mês do report ainda não fechou; os números refletem só até hoje e podem mudar até o fim do mês." }),
    republish: () => ({ t: "Já publicado neste mês", d: "Já existe um report publicado para este mês. Publicar de novo sobrescreve o snapshot congelado que o investidor já pode ter visto." }),
    allGood: "Tudo certo — nenhum item pendente para o fechamento deste mês.",
  },
  en: {
    soldNoPrice: (h: string) => ({ t: `${h}: sold without price`, d: "The home has a sale date but the sale price (soldPrice) is empty — the report would show the sale at US$0." }),
    soldNoNet: (h: string) => ({ t: `${h}: sold without net received`, d: "Sale date and price recorded, but net proceeds (netReceived) is empty. Without it the investor statement and IRR come out wrong." }),
    soldNoPayoff: (h: string) => ({ t: `${h}: sold with loan, no payoff`, d: "The home was sold and has a linked loan, but the bank payoff was not recorded — distributable cash is overstated." }),
    soldNoCost: (h: string) => ({ t: `${h}: sold without actual cost`, d: "Home sold this month with no actual lot/build cost — profit would be computed from plan, not actuals." }),
    noBaseline: () => ({ t: "No schedule baseline", d: "The pool has no frozen simulation baseline — the report's planned-vs-actual timeline section will be empty." }),
    monthOpen: (label: string) => ({ t: `Month still in progress (${label})`, d: "The report month hasn't closed; figures reflect only up to today and may change by month-end." }),
    republish: () => ({ t: "Already published this month", d: "A report is already published for this month. Republishing overwrites the frozen snapshot the investor may have seen." }),
    allGood: "All clear — nothing pending for this month's close.",
  },
};

export async function loadPreflight(poolId: string, month: string, lang: Lang): Promise<PreflightResult> {
  const tr = T[lang];
  const [y, m] = month.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59));
  const now = new Date();
  const asOf = monthEnd.getTime() < now.getTime() ? monthEnd : now;

  const pool = await prisma.investmentPool.findUnique({
    where: { id: poolId },
    select: {
      scheduleBaseline: true,
      houses: {
        select: {
          address: true, loanId: true, saleDate: true,
          soldPrice: true, netReceived: true, payoffAmount: true,
          actualLotCost: true, actualBuildCost: true,
        },
      },
      documents: { where: { reportMonth: month }, select: { id: true } },
    },
  });
  if (!pool) return { items: [], blockers: 0, warnings: 0 };

  const items: PreflightItem[] = [];
  const houseHref = `/pools/${poolId}?tab=houses`;
  const push = (severity: PreflightSeverity, x: { t: string; d: string }, href?: string) =>
    items.push({ severity, title: x.t, detail: x.d, href });

  // casas vendidas até a data-base do report
  for (const h of pool.houses) {
    const soldAsOf = h.saleDate && new Date(h.saleDate).getTime() <= asOf.getTime();
    if (!soldAsOf) continue;
    const label = h.address.split(",")[0];
    if (n(h.soldPrice) <= 0) push("BLOCKER", tr.soldNoPrice(label), houseHref);
    if (h.netReceived == null) push("BLOCKER", tr.soldNoNet(label), houseHref);
    if (h.loanId && h.payoffAmount == null) push("BLOCKER", tr.soldNoPayoff(label), houseHref);
    if (h.actualLotCost == null || h.actualBuildCost == null) push("WARNING", tr.soldNoCost(label), houseHref);
  }

  // pool-level
  const baseline = pool.scheduleBaseline as { houses?: unknown[] } | null;
  if (!baseline?.houses?.length) push("WARNING", tr.noBaseline(), `/pools/${poolId}?tab=schedule`);
  if (asOf.getTime() < monthEnd.getTime()) push("WARNING", tr.monthOpen(month));
  if (pool.documents.length > 0) push("WARNING", tr.republish());

  // BLOCKER antes de WARNING
  items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "BLOCKER" ? -1 : 1));
  return {
    items,
    blockers: items.filter((i) => i.severity === "BLOCKER").length,
    warnings: items.filter((i) => i.severity === "WARNING").length,
  };
}

export const preflightAllGoodText = (lang: Lang) => T[lang].allGood;
