import { prisma } from "@/lib/db";
import { obligationsFor, type Obligation } from "./rules";
import { loadTreatmentResolver } from "@/lib/tax/treatment";
import { isEffectiveAt, asOfYearEnd } from "@/lib/ownership/effective";

// Expande as obrigações (de rules.ts) em VENCIMENTOS DATADOS dentro de um ano-calendário,
// e cruza com o status gravado (feito/pendente/NA). Mensais, trimestrais e anuais.

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const d = (y: number, m: number, day: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export interface ScheduledDue {
  periodKey: string;
  periodLabel: string;
  dueDate: string; // ISO, sempre dentro do ano pedido
}

// Vencimentos de uma obrigação que caem DENTRO do ano-calendário `year`.
function dueDatesInYear(key: string, year: number): ScheduledDue[] {
  switch (key) {
    // ── Mensal: Sales & Use Tax (vence dia 20 do mês seguinte ao apurado) ──
    case "fl-sales-tax": {
      const out: ScheduledDue[] = [];
      for (let filing = 1; filing <= 12; filing++) {
        // mês apurado = mês anterior ao de pagamento
        const coveredM = filing === 1 ? 12 : filing - 1;
        const coveredY = filing === 1 ? year - 1 : year;
        out.push({
          periodKey: `${coveredY}-${String(coveredM).padStart(2, "0")}`,
          periodLabel: `${MONTHS[coveredM - 1]} ${coveredY}`,
          dueDate: d(year, filing, 20),
        });
      }
      return out;
    }

    // ── Trimestral: Form 941 (vence fim do mês seguinte ao trimestre) ──
    case "fed-941-940": {
      const q: ScheduledDue[] = [
        { periodKey: `${year - 1}-Q4`, periodLabel: `Q4 ${year - 1} (941)`, dueDate: d(year, 1, 31) },
        { periodKey: `${year}-Q1`, periodLabel: `Q1 ${year} (941)`, dueDate: d(year, 4, 30) },
        { periodKey: `${year}-Q2`, periodLabel: `Q2 ${year} (941)`, dueDate: d(year, 7, 31) },
        { periodKey: `${year}-Q3`, periodLabel: `Q3 ${year} (941)`, dueDate: d(year, 10, 31) },
      ];
      // 940 (FUTA) anual, do ano anterior, vence 31/jan
      q.push({ periodKey: `${year - 1}-940`, periodLabel: `${year - 1} (940 FUTA)`, dueDate: d(year, 1, 31) });
      return q;
    }

    // ── Trimestral: FL Reemployment Tax RT-6 ──
    case "fl-rt6":
      return [
        { periodKey: `${year - 1}-Q4`, periodLabel: `Q4 ${year - 1}`, dueDate: d(year, 1, 31) },
        { periodKey: `${year}-Q1`, periodLabel: `Q1 ${year}`, dueDate: d(year, 4, 30) },
        { periodKey: `${year}-Q2`, periodLabel: `Q2 ${year}`, dueDate: d(year, 7, 31) },
        { periodKey: `${year}-Q3`, periodLabel: `Q3 ${year}`, dueDate: d(year, 10, 31) },
      ];

    // ── Trimestral: estimativa federal corporativa ──
    case "fed-est":
      return [
        { periodKey: `${year}-Q1`, periodLabel: `Q1 ${year}`, dueDate: d(year, 4, 15) },
        { periodKey: `${year}-Q2`, periodLabel: `Q2 ${year}`, dueDate: d(year, 6, 15) },
        { periodKey: `${year}-Q3`, periodLabel: `Q3 ${year}`, dueDate: d(year, 9, 15) },
        { periodKey: `${year}-Q4`, periodLabel: `Q4 ${year}`, dueDate: d(year, 12, 15) },
      ];

    // ── Anuais (o vencimento cai no ano `year`; o período fiscal costuma ser year-1) ──
    case "fed-1120":
      return [{ periodKey: `${year - 1}`, periodLabel: `TY ${year - 1}`, dueDate: d(year, 4, 15) }];
    case "fed-1120s":
    case "fed-1065":
    case "fed-1446":
      return [{ periodKey: `${year - 1}`, periodLabel: `TY ${year - 1}`, dueDate: d(year, 3, 15) }];
    case "fed-sch-c":
      return [{ periodKey: `${year - 1}`, periodLabel: `TY ${year - 1}`, dueDate: d(year, 4, 15) }];
    case "fl-annual-report":
      return [{ periodKey: `${year}`, periodLabel: `${year}`, dueDate: d(year, 5, 1) }];
    case "fl-f1120":
    case "fl-f1065":
      return [{ periodKey: `${year - 1}`, periodLabel: `TY ${year - 1}`, dueDate: d(year, 5, 1) }];
    case "fl-tpp":
      return [{ periodKey: `${year}`, periodLabel: `${year}`, dueDate: d(year, 4, 1) }];
    case "fed-1099":
      return [{ periodKey: `${year - 1}`, periodLabel: `${year - 1}`, dueDate: d(year, 1, 31) }];

    // Sem data fixa (BOI/CTA, entidade estrangeira) → não entram no calendário.
    default:
      return [];
  }
}

export interface ObligationInstance {
  companyId: string;
  companyName: string;
  key: string;
  name: string;
  authority: string;
  frequency: string;
  periodKey: string;
  periodLabel: string;
  dueDate: string;
  status: "PENDING" | "FILED" | "NA";
  overdue: boolean;
}

export interface ObligationReference {
  companyId: string;
  companyName: string;
  treatment: string | null;
  obligations: Obligation[];
}

export interface ObligationCalendar {
  year: number;
  years: number[];
  companies: { id: string; legalName: string }[];
  instances: ObligationInstance[]; // ordenadas por vencimento
  reference: ObligationReference[]; // lista completa por empresa (inclui sem data: BOI etc.)
  counts: { overdue: number; pending: number; filed: number };
}

export async function buildObligationCalendar(
  year: number,
  companyFilter?: string,
): Promise<ObligationCalendar> {
  const [companies, resolveTreatment, ownerships, parties, statuses] = await Promise.all([
    prisma.company.findMany({
      where: { status: "ACTIVE", monitored: true },
      select: {
        id: true, legalName: true, jurisdiction: true, state: true,
        collectsSalesTax: true, hasEmployees: true,
      },
      orderBy: { legalName: "asc" },
    }),
    // Tributação por (empresa, ano) — fonte única (cadastro > IR exato > carry-forward).
    loadTreatmentResolver(),
    prisma.ownership.findMany({
      where: { ownerPartyId: { not: null }, ownedCompanyId: { not: null } },
      select: { ownedCompanyId: true, ownerPartyId: true, effectiveDate: true, endDate: true },
    }),
    prisma.party.findMany({ select: { id: true, taxJurisdiction: true } }),
    prisma.obligationStatus.findMany(),
  ]);

  const foreignPartyIds = new Set(
    parties.filter((p) => p.taxJurisdiction && p.taxJurisdiction !== "US").map((p) => p.id),
  );
  // Sócio estrangeiro VIGENTE no ano (fonte única isEffectiveAt) — antes contava qualquer ownership
  // de qualquer época (um sócio que saiu ainda disparava withholding).
  const asOf = asOfYearEnd(year);
  const foreignByCompany = new Set<string>();
  for (const o of ownerships) {
    if (o.ownedCompanyId && o.ownerPartyId && foreignPartyIds.has(o.ownerPartyId) && isEffectiveAt(o, asOf)) {
      foreignByCompany.add(o.ownedCompanyId);
    }
  }
  const statusMap = new Map<string, { status: string }>();
  for (const s of statuses) statusMap.set(`${s.companyId}|${s.key}|${s.periodKey}`, s);

  const today = new Date().toISOString().slice(0, 10);
  const instances: ObligationInstance[] = [];
  const reference: ObligationReference[] = [];

  const scope = companyFilter ? companies.filter((c) => c.id === companyFilter) : companies;
  for (const c of scope) {
    const treatment = resolveTreatment(c.id, year).treatment;
    const obls: Obligation[] = obligationsFor({
      jurisdiction: c.jurisdiction,
      state: c.state,
      taxTreatment: treatment,
      collectsSalesTax: c.collectsSalesTax,
      hasEmployees: c.hasEmployees,
      hasForeignPartners: foreignByCompany.has(c.id),
    });
    reference.push({ companyId: c.id, companyName: c.legalName, treatment, obligations: obls });
    for (const o of obls) {
      for (const due of dueDatesInYear(o.key, year)) {
        const st = statusMap.get(`${c.id}|${o.key}|${due.periodKey}`);
        const status = (st?.status as "FILED" | "NA" | undefined) ?? "PENDING";
        instances.push({
          companyId: c.id,
          companyName: c.legalName,
          key: o.key,
          name: o.name,
          authority: o.authority,
          frequency: o.frequency,
          periodKey: due.periodKey,
          periodLabel: due.periodLabel,
          dueDate: due.dueDate,
          status,
          overdue: status === "PENDING" && due.dueDate < today,
        });
      }
    }
  }

  instances.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.companyName.localeCompare(b.companyName));

  // Anos disponíveis: corrente ± alguns, para o seletor.
  const cur = new Date().getUTCFullYear();
  const years = [cur - 1, cur, cur + 1];

  return {
    year,
    years,
    companies: companies.map((c) => ({ id: c.id, legalName: c.legalName })),
    instances,
    reference,
    counts: {
      overdue: instances.filter((i) => i.overdue).length,
      pending: instances.filter((i) => i.status === "PENDING").length,
      filed: instances.filter((i) => i.status === "FILED").length,
    },
  };
}
