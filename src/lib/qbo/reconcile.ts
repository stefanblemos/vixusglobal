// Conciliação intercompany: cruza os dois lados de posições entre entidades.
// Lado A (credor): linha de ATIVO sob "Loans to Others" nomeando a empresa B.
// Lado B (devedor): qualquer linha de PASSIVO nomeando a empresa A.
// Se os dois lados batem → conciliado; se divergem → mismatch; se só um → one-sided.

import type { DetectLine } from "./detect";

export interface Position {
  reportedBy: string; // companyId que reportou
  creditorId: string;
  debtorId: string;
  amount: number; // absoluto
  kind: "RECEIVABLE" | "PAYABLE";
}

export function extractPositions(
  reportedBy: string,
  lines: DetectLine[],
  resolve: (name: string) => string | null,
): Position[] {
  const out: Position[] = [];
  for (const l of lines) {
    if (l.lineType !== "ACCOUNT") continue;
    const other = resolve(l.label);
    if (!other || other === reportedBy) continue;

    const path = l.sectionPath.map((s) => s.toLowerCase());
    const isAsset = (path[0] ?? "").includes("asset");
    const isLiab = path.some((s) => s.includes("liabilit"));
    const underLoans = path.some((s) => /loans?\s+to\s+others/.test(s));
    const amt = Math.abs(Number(l.amount ?? 0));
    if (!amt) continue;

    if (isAsset && underLoans) {
      out.push({
        reportedBy,
        creditorId: reportedBy,
        debtorId: other,
        amount: amt,
        kind: "RECEIVABLE",
      });
    } else if (isLiab) {
      out.push({
        reportedBy,
        creditorId: other,
        debtorId: reportedBy,
        amount: amt,
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
  creditorAmount: number | null; // o que o credor reporta como receber
  debtorAmount: number | null; // o que o devedor reporta como dever
  diff: number;
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
        status: "ONE_SIDED",
      };
      map.set(k, row);
    }
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
      row.status = row.diff < 0.01 ? "RECONCILED" : "MISMATCH";
    } else {
      row.status = "ONE_SIDED";
    }
  }

  return [...map.values()].sort((a, b) => a.status.localeCompare(b.status));
}
