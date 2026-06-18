// Obrigações fiscais/societárias de uma empresa do grupo, derivadas do tipo de entidade,
// jurisdição (foco Flórida), tributação e flags (revende produtos / tem folha / sócio
// estrangeiro). Datas para ano-calendário (fim em 31/12). NÃO substitui o contador —
// é um checklist/calendário; confirme cada item.

export type Authority = "IRS" | "FL DOR" | "Sunbiz (FL DOS)" | "County" | "FinCEN";
export type Frequency = "Annual" | "Quarterly" | "Monthly" | "One-time" | "As needed";

export type Obligation = {
  key: string;
  name: string;
  authority: Authority;
  frequency: Frequency;
  due: string; // rótulo legível do vencimento
  applies: "yes" | "review"; // review = depende de fato a confirmar
  note?: string;
};

export type ObligationFacts = {
  jurisdiction: string | null; // US | BR | PT | OTHER
  state: string | null; // ex.: "FL"
  taxTreatment: string | null; // C_CORP | PARTNERSHIP | S_CORP | DISREGARDED | ...
  collectsSalesTax: boolean;
  hasEmployees: boolean;
  hasForeignPartners: boolean;
};

export function obligationsFor(f: ObligationFacts): Obligation[] {
  // Entidade não-americana: obrigações são locais (não modeladas aqui).
  if (f.jurisdiction && f.jurisdiction.toUpperCase() !== "US") {
    return [
      {
        key: "foreign",
        name: "Foreign-jurisdiction entity — obligations handled locally (not modeled here)",
        authority: "FinCEN",
        frequency: "As needed",
        due: "—",
        applies: "review",
        note: `Jurisdiction: ${f.jurisdiction}. US reporting (5471/8865/FBAR) may apply to US owners.`,
      },
    ];
  }
  const fl = (f.state ?? "").toUpperCase() === "FL";
  const tt = (f.taxTreatment ?? "").toUpperCase();
  const out: Obligation[] = [];

  // ── Federal: declaração de renda conforme a tributação ──────────────────────
  if (tt === "C_CORP") {
    out.push({ key: "fed-1120", name: "Federal income tax — Form 1120", authority: "IRS", frequency: "Annual", due: "Apr 15 (ext 7004 → Oct 15)", applies: "yes" });
    out.push({ key: "fed-est", name: "Federal estimated tax (corporate)", authority: "IRS", frequency: "Quarterly", due: "Apr 15 · Jun 15 · Sep 15 · Dec 15", applies: "review", note: "If the corp expects to owe $500+." });
  } else if (tt === "S_CORP") {
    out.push({ key: "fed-1120s", name: "Federal income tax — Form 1120-S", authority: "IRS", frequency: "Annual", due: "Mar 15 (ext 7004 → Sep 15)", applies: "yes" });
  } else if (tt === "DISREGARDED") {
    out.push({ key: "fed-sch-c", name: "Reported on the owner's return (disregarded SMLLC)", authority: "IRS", frequency: "Annual", due: "with owner's 1040/1120", applies: "yes" });
  } else {
    out.push({ key: "fed-1065", name: "Federal income tax — Form 1065 (partnership)", authority: "IRS", frequency: "Annual", due: "Mar 15 (ext 7004 → Sep 15)", applies: "yes" });
  }

  // §1446 — retenção sobre sócio estrangeiro (partnership)
  if ((tt === "PARTNERSHIP" || tt === "") && f.hasForeignPartners) {
    out.push({ key: "fed-1446", name: "§1446 foreign-partner withholding — Forms 8804/8805 (+ 8813 quarterly)", authority: "IRS", frequency: "Annual", due: "with the 1065; deposits quarterly", applies: "yes", note: "Partnership has foreign partners." });
  }

  // ── Flórida ─────────────────────────────────────────────────────────────────
  if (fl) {
    out.push({ key: "fl-annual-report", name: "Annual Report (keeps the entity active)", authority: "Sunbiz (FL DOS)", frequency: "Annual", due: "May 1 (late fee $400 after)", applies: "yes" });

    if (tt === "C_CORP") {
      out.push({ key: "fl-f1120", name: "Florida corporate income tax — F-1120", authority: "FL DOR", frequency: "Annual", due: "May 1 (1st day of 5th month)", applies: "yes" });
    } else if (tt === "PARTNERSHIP" || tt === "") {
      out.push({ key: "fl-f1065", name: "Florida partnership return — F-1065 (informational)", authority: "FL DOR", frequency: "Annual", due: "~May 1", applies: "review", note: "Generally no FL entity-level tax on partnerships." });
    }

    if (f.collectsSalesTax) {
      out.push({ key: "fl-sales-tax", name: "Florida Sales & Use Tax (reseller)", authority: "FL DOR", frequency: "Monthly", due: "1st of next month (late after the 20th)", applies: "yes", note: "Register (DR-1); filing frequency depends on collections." });
    }

    out.push({ key: "fl-tpp", name: "Tangible Personal Property Tax — DR-405", authority: "County", frequency: "Annual", due: "Apr 1", applies: "review", note: "If the business owns equipment/furniture/fixtures." });

    if (f.hasEmployees) {
      out.push({ key: "fl-rt6", name: "Florida Reemployment Tax — RT-6", authority: "FL DOR", frequency: "Quarterly", due: "end of month after each quarter", applies: "yes" });
    }
  }

  // ── Folha / contratados / beneficial ownership ──────────────────────────────
  if (f.hasEmployees) {
    out.push({ key: "fed-941-940", name: "Payroll — Forms 941 (quarterly) & 940 (annual)", authority: "IRS", frequency: "Quarterly", due: "941: end of month after each quarter; 940: Jan 31", applies: "yes" });
  }
  out.push({ key: "fed-1099", name: "1099-NEC for contractors paid $600+", authority: "IRS", frequency: "Annual", due: "Jan 31", applies: "review" });
  out.push({ key: "boi", name: "Beneficial Ownership Information (Corporate Transparency Act)", authority: "FinCEN", frequency: "As needed", due: "within 30 days of any ownership change", applies: "review", note: "Confirm current CTA status/requirement." });

  return out;
}
