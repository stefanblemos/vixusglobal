import { entityNames, ownerNameMatches } from "@/lib/ownership/reconcile";

// Distribuições de lucro NO QBO (fora do K-1). O contador deduz a distribuição como despesa
// na subsidiária e a holding lança como "other income" — então o número não aparece claro no
// IR, só nos relatórios do QBO. Este módulo lê os dois lados do P&L e os correlaciona.
//
//  Lado PAGADOR (subsidiária):  seções "Profit Sharing Distribution" / "Profit Other
//                               Investors Distribution" (deduzidas como despesa).
//  Lado RECEBEDOR (holding):    seção "Investment Income - 1099 (Profit Distribution -Not K1)".

export type DistLine = { counterpartyName: string; amount: number };

// Reconhece a seção do RECEBEDOR ("...1099..." / "...Not K1...").
const NOT_K1 = /1099|not\s*-?\s*k\.?-?\s*1/i;
// Reconhece a seção do PAGADOR ("Profit (Sharing|Other Investors) Distribution").
const DIST_PAID = /profit\s+(?:sharing\s+|other\s+investors\s+)?distribution/i;

const last = (path: string[]) => path[path.length - 1] ?? "";

// Mínimo de uma linha — compatível com QboLine do parser (value em `values[0]`) e com
// QboImportLine do banco (value singular).
type LineLike = {
  label: string;
  sectionPath: string[];
  lineType: string;
  value?: unknown;
  values?: (string | null)[];
};
const lineValue = (l: LineLike): number | null => {
  const raw = l.value ?? l.values?.[0];
  if (raw == null) return null;
  return typeof raw === "number" ? raw : Number(raw) || null;
};

// Distribuições PAGAS pela empresa (deduzidas no P&L dela): a quem e quanto.
export function distributionsPaid(lines: LineLike[]): DistLine[] {
  const out: DistLine[] = [];
  for (const l of lines) {
    if (l.lineType !== "ACCOUNT") continue;
    const v = lineValue(l);
    if (v == null) continue;
    const sec = last(l.sectionPath);
    if (DIST_PAID.test(sec) && !NOT_K1.test(sec)) out.push({ counterpartyName: l.label, amount: v });
  }
  return out;
}

// Distribuições RECEBIDAS pela empresa (lançadas como "1099 - Not K1"): de quem e quanto.
// Pega tanto a entrada direta (ex.: "Avantec Engineering Solutions $4.500") quanto o subtotal
// por emissor ("Total for Avantech Group Investment $157.223"), sem duplicar as linhas de imóvel.
export function distributionsReceived(lines: LineLike[]): DistLine[] {
  const out: DistLine[] = [];
  for (const l of lines) {
    const v = lineValue(l);
    if (v == null) continue;
    if (l.lineType === "ACCOUNT" && NOT_K1.test(last(l.sectionPath))) {
      out.push({ counterpartyName: l.label, amount: v });
    } else if (l.lineType === "TOTAL") {
      const m = l.label.match(/^total\s+(?:for\s+|para\s+)?(.+)$/i);
      const subj = m?.[1]?.trim();
      if (subj && !NOT_K1.test(subj) && l.sectionPath.some((s) => NOT_K1.test(s))) {
        out.push({ counterpartyName: subj, amount: v });
      }
    }
  }
  return out;
}

// Extrato de uma empresa/ano: o que pagou e o que recebeu de distribuição (pelo QBO).
export type DistExtract = {
  companyId: string;
  year: number | null;
  paid: DistLine[];
  received: DistLine[];
};

type DistCompany = { id: string; legalName: string; tradeName: string | null; aliases: string[] };

// Uma aresta de distribuição emissor → recebedor, com os dois lados do QBO.
export type DistEdge = {
  issuerId: string | null;
  issuerName: string;
  recipientId: string;
  recipientName: string;
  year: number | null;
  bookedByRecipient: number; // lançado como income no P&L da holding
  paidByIssuer: number | null; // deduzido no P&L da subsidiária (null = P&L da subsidiária não carregado)
  status: "matched" | "amountDiff" | "issuerNotLoaded";
};

// Monta os extratos (pago/recebido) a partir dos imports e linhas crus do banco. Espera os
// imports ordenados do mais recente p/ o mais antigo — o 1º de cada empresa/ano vence.
type RawImport = { id: string; companyId: string | null; periodLabel: string | null };
export function buildDistExtracts(
  imports: RawImport[],
  lines: (LineLike & { importId: string })[],
): DistExtract[] {
  const byImport = new Map<string, (LineLike & { importId: string })[]>();
  for (const l of lines) {
    const arr = byImport.get(l.importId);
    if (arr) arr.push(l);
    else byImport.set(l.importId, [l]);
  }
  const seen = new Set<string>();
  const out: DistExtract[] = [];
  for (const imp of imports) {
    if (!imp.companyId) continue;
    const y = imp.periodLabel?.match(/\b(20\d{2})\b/)?.[1];
    const key = `${imp.companyId}:${y ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ls = byImport.get(imp.id) ?? [];
    out.push({
      companyId: imp.companyId,
      year: y ? Number(y) : null,
      paid: distributionsPaid(ls),
      received: distributionsReceived(ls),
    });
  }
  return out;
}

const resolve = (name: string, companies: DistCompany[]) =>
  companies.find((c) => ownerNameMatches(entityNames(c), name)) ?? null;

// Correlaciona as distribuições recebidas (P&L da holding) com as pagas (P&L da subsidiária).
export function reconcileDistributions(
  extracts: DistExtract[],
  companies: DistCompany[],
): DistEdge[] {
  const byCompanyYear = new Map<string, DistExtract>();
  for (const e of extracts) byCompanyYear.set(`${e.companyId}:${e.year}`, e);

  const edges: DistEdge[] = [];
  for (const recip of extracts) {
    const recipCo = companies.find((c) => c.id === recip.companyId);
    for (const r of recip.received) {
      const issuer = resolve(r.counterpartyName, companies);
      // P&L da subsidiária no mesmo ano (se carregado) → quanto ela diz ter pago a esta holding.
      let paidByIssuer: number | null = null;
      if (issuer) {
        const issuerExtract = byCompanyYear.get(`${issuer.id}:${recip.year}`);
        if (issuerExtract) {
          const match = issuerExtract.paid.find(
            (p) => recipCo && ownerNameMatches(entityNames(recipCo), p.counterpartyName),
          );
          paidByIssuer = match ? match.amount : 0; // 0 = P&L existe mas não mostra pagamento a esta holding
        }
      }
      const tol = Math.max(1, Math.abs(r.amount) * 0.01);
      const status: DistEdge["status"] =
        paidByIssuer == null
          ? "issuerNotLoaded"
          : Math.abs(paidByIssuer - r.amount) <= tol
            ? "matched"
            : "amountDiff";
      edges.push({
        issuerId: issuer?.id ?? null,
        issuerName: issuer?.legalName ?? r.counterpartyName,
        recipientId: recip.companyId,
        recipientName: recipCo?.legalName ?? recip.companyId,
        year: recip.year,
        bookedByRecipient: r.amount,
        paidByIssuer,
        status,
      });
    }
  }
  return edges;
}
