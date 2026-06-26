import { prisma } from "@/lib/db";

// Controle do imposto estadual de renda (ex.: Florida F-1120) por empresa e ano de competência.
// O ponto-chave é o descasamento temporal book↔tax:
//   • o PRINCIPAL é deduzido no federal no ANO DE COMPETÊNCIA (taxYear);
//   • o pagamento (principal + multa + juros) costuma cair no ANO SEGUINTE, e é quando os livros
//     lançam a despesa. Por isso, no Schedule M-1 do ano do pagamento, o principal volta como
//     add-back (já foi deduzido antes) e a multa também (não dedutível). Os juros, para C-corp,
//     são dedutíveis (§163) — não deveriam ser adicionados de volta.
// Este módulo expõe exatamente essa composição, para explicar o add-back de "State income tax"
// sem precisar perguntar ao contador.

export interface StateTaxFilingView {
  id: string;
  jurisdiction: string;
  taxYear: number; // competência (principal deduzido aqui)
  principal: number;
  penalty: number;
  interest: number;
  total: number;
  paidDate: string | null;
  paidYear: number | null; // ano em que o add-back do M-1 aparece
  source: string | null;
  note: string | null;
  // M-1 do ano do pagamento:
  addBack: number; // principal + multa (o que DEVE voltar)
  addBackWithInterest: number; // principal + multa + juros (se o contador também adicionou os juros)
  interestDeductible: number; // juros — potencial dedução p/ C-corp
}

export interface StateTaxCompany {
  companyId: string;
  name: string;
  state: string | null;
  filings: StateTaxFilingView[];
}

export interface StateTaxControl {
  companies: StateTaxCompany[];
  companyOptions: { id: string; legalName: string }[];
  totals: { principal: number; penalty: number; interest: number; total: number };
}

const dec = (v: unknown) => Number((v as { toString(): string } | null)?.toString() ?? 0);

export async function buildStateTaxControl(companyFilter?: string): Promise<StateTaxControl> {
  const [filings, companyOptions] = await Promise.all([
    prisma.stateTaxFiling.findMany({
      where: companyFilter ? { companyId: companyFilter } : {},
      include: { company: { select: { legalName: true, state: true } } },
      orderBy: [{ companyId: "asc" }, { taxYear: "desc" }],
    }),
    // Empresas que podem ter imposto estadual: US monitoradas (o estadual é dos EUA).
    prisma.company.findMany({
      where: { jurisdiction: "US" },
      select: { id: true, legalName: true },
      orderBy: { legalName: "asc" },
    }),
  ]);

  const byCompany = new Map<string, StateTaxCompany>();
  const totals = { principal: 0, penalty: 0, interest: 0, total: 0 };

  for (const f of filings) {
    const principal = dec(f.principal);
    const penalty = dec(f.penalty);
    const interest = dec(f.interest);
    const total = Math.round((principal + penalty + interest) * 100) / 100;
    const paidYear = f.paidDate ? f.paidDate.getUTCFullYear() : null;

    const view: StateTaxFilingView = {
      id: f.id,
      jurisdiction: f.jurisdiction,
      taxYear: f.taxYear,
      principal,
      penalty,
      interest,
      total,
      paidDate: f.paidDate ? f.paidDate.toISOString().slice(0, 10) : null,
      paidYear,
      source: f.source,
      note: f.note,
      addBack: Math.round((principal + penalty) * 100) / 100,
      addBackWithInterest: total,
      interestDeductible: interest,
    };

    const g =
      byCompany.get(f.companyId) ??
      ({ companyId: f.companyId, name: f.company.legalName, state: f.company.state, filings: [] } as StateTaxCompany);
    g.filings.push(view);
    byCompany.set(f.companyId, g);

    totals.principal += principal;
    totals.penalty += penalty;
    totals.interest += interest;
    totals.total += total;
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    companies: [...byCompany.values()].sort((a, b) => a.name.localeCompare(b.name)),
    companyOptions,
    totals: {
      principal: round(totals.principal),
      penalty: round(totals.penalty),
      interest: round(totals.interest),
      total: round(totals.total),
    },
  };
}
