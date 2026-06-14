// Conciliação intercompany: cruza os dois lados de posições entre entidades.
// Lado A (credor): linha de ATIVO sob "Loans to Others" nomeando a empresa B.
// Lado B (devedor): qualquer linha de PASSIVO nomeando a empresa A.
// Se os dois lados batem → conciliado; se divergem → mismatch; se só um → one-sided.

import type { DetectLine } from "./detect";

export interface Position {
  reportedBy: string; // companyId que reportou
  creditorId: string;
  debtorId: string;
  amount: number; // absoluto (na moeda informada)
  currency: string; // moeda do relatório de origem
  kind: "RECEIVABLE" | "PAYABLE";
}

export function extractPositions(
  reportedBy: string,
  lines: DetectLine[],
  resolve: (name: string) => string | null,
  currency = "USD",
): Position[] {
  const out: Position[] = [];
  for (const l of lines) {
    if (l.lineType !== "ACCOUNT") continue;
    const other = resolve(l.label);
    if (!other || other === reportedBy) continue;

    const path = l.sectionPath.map((s) => s.toLowerCase());
    // O cabeçalho combinado "Liabilities and Equity" / "Passivos e capital próprio"
    // contém ambas as palavras — ignorá-lo ao decidir o ramo (passivo vs patrimônio).
    const isCombined = (s: string) => /liabilities and equity|passivos e capital/.test(s);
    const liabSeg = path.some((s) => !isCombined(s) && (/liabilit/.test(s) || /passivo/.test(s)));
    const equitySeg = path.some(
      (s) => !isCombined(s) && /equity|capital pr|capital dos acion/.test(s),
    );
    const isAsset = (path[0] ?? "").includes("asset") || (path[0] ?? "").includes("ativo");
    const isLiab = liabSeg && !equitySeg;
    const underLoans = path.some((s) => /loans?\s+to\s+others/.test(s));
    const amt = Math.abs(Number(l.amount ?? 0));
    if (!amt) continue;

    if (isAsset && underLoans) {
      out.push({
        reportedBy,
        creditorId: reportedBy,
        debtorId: other,
        amount: amt,
        currency,
        kind: "RECEIVABLE",
      });
    } else if (isLiab) {
      out.push({
        reportedBy,
        creditorId: other,
        debtorId: reportedBy,
        amount: amt,
        currency,
        kind: "PAYABLE",
      });
    }
  }
  return out;
}

export type ReconStatus = "RECONCILED" | "MISMATCH" | "ONE_SIDED";

export interface ReconRow {
  creditorId: string;
  debtorId: string;
  creditorAmount: number | null; // USD — o que o credor reporta como receber
  debtorAmount: number | null; // USD — o que o devedor reporta como dever
  diff: number;
  fxApplied: boolean; // algum lado foi convertido de outra moeda
  status: ReconStatus;
}

export function reconcile(positions: Position[]): ReconRow[] {
  const map = new Map<string, ReconRow>();
  const key = (c: string, d: string) => `${c}|${d}`;

  for (const p of positions) {
    const k = key(p.creditorId, p.debtorId);
    let row = map.get(k);
    if (!row) {
      row = {
        creditorId: p.creditorId,
        debtorId: p.debtorId,
        creditorAmount: null,
        debtorAmount: null,
        diff: 0,
        fxApplied: false,
        status: "ONE_SIDED",
      };
      map.set(k, row);
    }
    if (p.currency !== "USD") row.fxApplied = true;
    if (p.kind === "RECEIVABLE" && p.reportedBy === p.creditorId) {
      row.creditorAmount = (row.creditorAmount ?? 0) + p.amount;
    }
    if (p.kind === "PAYABLE" && p.reportedBy === p.debtorId) {
      row.debtorAmount = (row.debtorAmount ?? 0) + p.amount;
    }
  }

  for (const row of map.values()) {
    if (row.creditorAmount != null && row.debtorAmount != null) {
      row.diff = Math.abs(row.creditorAmount - row.debtorAmount);
      // FX: tolerância relativa (1%); mesma moeda: estrito ($0,01).
      const tol = row.fxApplied
        ? Math.max(1, 0.01 * Math.max(row.creditorAmount, row.debtorAmount))
        : 0.01;
      row.status = row.diff <= tol ? "RECONCILED" : "MISMATCH";
    } else {
      row.status = "ONE_SIDED";
    }
  }

  return [...map.values()].sort((a, b) => a.status.localeCompare(b.status));
}
