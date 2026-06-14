// Exposição de empréstimos de uma empresa: TODOS os loans a receber (ativo) e a
// pagar (passivo) do balanço — casados ou não com entidades cadastradas.
// Diferente da conciliação (que exige as duas pontas internas), aqui mostramos
// tudo, inclusive credores externos, para o controle de assets/liabilities.

import type { DetectLine } from "./detect";

export interface ExposureItem {
  counterpartyName: string; // rótulo cru da linha
  counterpartyId: string | null; // empresa cadastrada, se casar
  kind: "RECEIVABLE" | "PAYABLE";
  amount: number; // moeda local, absoluto
}

const LOAN_KW =
  /loan|empréstimo|emprestimo|notes?\s+payable|builder.?s capital|business loans?|loans?\s+from|financing|construction loan/i;

export function extractExposure(
  lines: DetectLine[],
  resolve: (name: string) => string | null,
): ExposureItem[] {
  const out: ExposureItem[] = [];
  for (const l of lines) {
    if (l.lineType !== "ACCOUNT") continue;
    const amt = Math.abs(Number(l.amount ?? 0));
    if (!amt) continue;

    const path = l.sectionPath.map((s) => s.toLowerCase());
    const isCombined = (s: string) => /liabilities and equity|passivos e capital/.test(s);
    const liabSeg = path.some((s) => !isCombined(s) && (/liabilit/.test(s) || /passivo/.test(s)));
    const equitySeg = path.some(
      (s) => !isCombined(s) && /equity|capital pr|capital dos acion/.test(s),
    );
    const isLiab = liabSeg && !equitySeg;
    const isAsset = (path[0] ?? "").includes("asset") || (path[0] ?? "").includes("ativo");
    const underReceivable = path.some((s) => /loans?\s+to\s+others/.test(s));
    const loanKw = path.some((s) => LOAN_KW.test(s)) || LOAN_KW.test(l.label);
    const id = resolve(l.label);

    if (isAsset && underReceivable) {
      out.push({ counterpartyName: l.label, counterpartyId: id, kind: "RECEIVABLE", amount: amt });
    } else if (isLiab && (loanKw || id)) {
      out.push({ counterpartyName: l.label, counterpartyId: id, kind: "PAYABLE", amount: amt });
    }
  }
  return out;
}
