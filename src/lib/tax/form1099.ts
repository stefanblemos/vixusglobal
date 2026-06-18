import { prisma } from "@/lib/db";

// Worklist de 1099-NEC a partir do General Ledger — para CONTROLE (o usuário confere no QBO).
// Base = desembolsos de caixa (cash basis) por beneficiário no ano-calendário:
// soma das linhas com amount<0 cujo tipo é um pagamento por banco/cheque.
// Pagamentos por cartão (Bill Payment (Credit Card)) vão para o 1099-K do processador → fora do NEC.

const BILL_PAY = /^bill payment/i; // Bill Payment (Check) | (Credit Card)
const DIRECT_PAY = /^(expense|check|cash expense|debit|eft|ach|wire)/i;
// Cada pagamento gera DUAS linhas no GL. Para contar uma só:
//  - bill payment → conta o lado A/P (account = A/P); a forma (banco/cartão) vem do split;
//  - pagamento direto → conta o lado caixa (account != A/P).
const AP_ACCT = /accounts? payable|(^|\W)a\/p(\W|$)/i;
// Indica pagamento por cartão → vai pro 1099-K do processador, fora do NEC.
const CARD_ACCT = /credit card|(^|\W)cc(\W|$)|\bvisa\b|\bamex\b|american express|mastercard|discover/i;

const GOODS = /cost of goods|cogs|inventory|merchandise|freight|shipping/i;
const TAXKW = /sales tax|payroll|income tax|department of revenue|franchise|estimated tax|\b941\b|\b940\b/i;
const NONSVC = /transfer|owner|distribution|draw|equity|capital|\bloan\b|due to|due from|intercompany|reimburs/i;

const THRESHOLD = 600;

export interface Payee1099 {
  key: string;
  name: string;
  total: number;
  count: number;
  firstDate: string;
  lastDate: string;
  categories: string[];
  flags: string[]; // "owner/related" | "review category"
}

export interface Worklist1099 {
  companyId: string;
  companyName: string;
  year: number;
  years: number[];
  payees: Payee1099[]; // ≥ $600, candidatos a 1099-NEC
  belowCount: number;
  belowTotal: number;
  excludedIntercompany: { name: string; total: number }[];
  cardPaidTotal: number; // pago por cartão (1099-K, fora do NEC)
  cardPaidCount: number;
}

interface Acc {
  key: string;
  name: string;
  intercompany: boolean;
  owner: boolean;
  total: number;
  count: number;
  first: number;
  last: number;
  splits: Map<string, number>;
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function build1099Worklist(
  companyId: string,
  wantedYear?: number,
): Promise<Worklist1099> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { legalName: true },
  });

  const yearRows = await prisma.$queryRaw<{ y: number }[]>`
    SELECT DISTINCT EXTRACT(YEAR FROM date)::int AS y
    FROM "LedgerTxn" WHERE "companyId" = ${companyId} ORDER BY y DESC
  `;
  const years = yearRows.map((r) => r.y);
  const year = wantedYear && years.includes(wantedYear) ? wantedYear : (years[0] ?? new Date().getUTCFullYear());

  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
  const txns = await prisma.ledgerTxn.findMany({
    where: { companyId, date: { gte: start, lte: end }, amount: { lt: 0 } },
    include: { vendor: true },
  });

  const map = new Map<string, Acc>();
  let cardPaidTotal = 0;
  let cardPaidCount = 0;

  for (const t of txns) {
    const type = t.type ?? "";
    const isBill = BILL_PAY.test(type);
    const isDirect = !isBill && DIRECT_PAY.test(type);
    if (!isBill && !isDirect) continue;

    const isAP = AP_ACCT.test(t.account);
    // Conta um único lado por pagamento (senão dobra o valor).
    if (isBill && !isAP) continue;
    if (isDirect && isAP) continue;

    const name = (t.vendor?.name ?? t.rawName ?? "").trim();
    if (!name) continue;

    const amt = Math.abs(Number(t.amount.toString()));

    // Forma de pagamento = a "outra" conta: split (bill payment) ou a própria conta (direto).
    const other = isBill ? (t.split ?? "") : t.account;
    if (CARD_ACCT.test(other)) {
      cardPaidTotal += amt;
      cardPaidCount += 1;
      continue;
    }

    const key = t.vendorId ?? `raw:${name.toLowerCase()}`;
    const ms = t.date.getTime();
    let a = map.get(key);
    if (!a) {
      a = {
        key,
        name,
        intercompany: !!t.vendor?.matchedCompanyId,
        owner: !!t.vendor?.matchedPartyId,
        total: 0,
        count: 0,
        first: ms,
        last: ms,
        splits: new Map(),
      };
      map.set(key, a);
    }
    a.total += amt;
    a.count += 1;
    a.first = Math.min(a.first, ms);
    a.last = Math.max(a.last, ms);
    if (t.split) a.splits.set(t.split, (a.splits.get(t.split) ?? 0) + amt);
  }

  // Categoria real da despesa vem das linhas tipo "Bill" (account = categoria, ex.: "Contractors",
  // "Job materials"). No pagamento, o split é só "A/P" — pouco informativo.
  const bills = await prisma.ledgerTxn.findMany({
    where: { companyId, date: { gte: start, lte: end }, type: "Bill", amount: { gt: 0 } },
    select: { vendorId: true, rawName: true, account: true, amount: true },
  });
  const catByKey = new Map<string, Map<string, number>>();
  for (const b of bills) {
    if (AP_ACCT.test(b.account)) continue;
    const name = (b.rawName ?? "").trim();
    const key = b.vendorId ?? (name ? `raw:${name.toLowerCase()}` : null);
    if (!key) continue;
    const m = catByKey.get(key) ?? new Map<string, number>();
    m.set(b.account, (m.get(b.account) ?? 0) + Number(b.amount.toString()));
    catByKey.set(key, m);
  }
  const catsFor = (key: string, splits: Map<string, number>): string[] => {
    const src = catByKey.get(key);
    const entries = src
      ? [...src.entries()]
      : [...splits.entries()].filter(([s]) => !AP_ACCT.test(s));
    return entries
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([s]) => s);
  };

  const all = [...map.values()];
  const excludedIntercompany = all
    .filter((a) => a.intercompany)
    .map((a) => ({ name: a.name, total: a.total }))
    .sort((x, y) => y.total - x.total);

  const considered = all.filter((a) => !a.intercompany);
  const below = considered.filter((a) => a.total < THRESHOLD);
  const payees: Payee1099[] = considered
    .filter((a) => a.total >= THRESHOLD)
    .sort((x, y) => y.total - x.total)
    .map((a) => {
      const categories = catsFor(a.key, a.splits);
      const flags: string[] = [];
      if (a.owner) flags.push("owner/related");
      if (categories.some((c) => GOODS.test(c) || TAXKW.test(c) || NONSVC.test(c)))
        flags.push("review category");
      return {
        key: a.key,
        name: a.name,
        total: a.total,
        count: a.count,
        firstDate: iso(a.first),
        lastDate: iso(a.last),
        categories,
        flags,
      };
    });

  return {
    companyId,
    companyName: company?.legalName ?? "—",
    year,
    years,
    payees,
    belowCount: below.length,
    belowTotal: below.reduce((s, a) => s + a.total, 0),
    excludedIntercompany,
    cardPaidTotal,
    cardPaidCount,
  };
}
