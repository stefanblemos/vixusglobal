import { effectiveFiguresOf } from "@/lib/ir/figures";

/**
 * Retificação de IR (#IR-amend).
 *
 * REGRA DE OURO: o IR NUNCA altera os livros (QBO). São bases de COMPARAÇÃO. Se a
 * retificadora muda a depreciação, isso aparece como diferença na Conferência e o ajuste
 * nos livros/ativos é feito MANUALMENTE — nada aqui mexe em lançamento contábil.
 *
 * "Vigente" = declaração não substituída. Duas vigentes no mesmo ano podem ser LEGÍTIMAS
 * (períodos curtos de conversão: 1120-S final + 1065), por isso a substituição é sempre
 * declarada pelo usuário — nunca inferida de empresa+ano.
 */

// where-clause padrão dos CÁLCULOS: só declarações vigentes.
export const ACTIVE_RETURN = { supersededById: null } as const;

export type AmendChoice = "AMENDMENT" | "SEPARATE" | "DUPLICATE";

type FigureLike = { key?: string; label?: string; value?: number | null; line?: string | null };
type ReturnLike = {
  figures?: unknown;
  manualFigures?: unknown;
  netIncome?: unknown;
  ordinaryIncome?: unknown;
  owners?: unknown;
};

export type FigureDiff = { key: string; label: string; before: number | null; after: number | null; delta: number | null };
export type OwnerDiff = { name: string; beforePct: number | null; afterPct: number | null; beforeIncome: number | null; afterIncome: number | null };

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Diferenças entre a declaração ORIGINAL e a RETIFICADORA — é o que diz o tamanho do impacto.
export function diffReturns(before: ReturnLike, after: ReturnLike): { figures: FigureDiff[]; owners: OwnerDiff[] } {
  const fb = (effectiveFiguresOf(before as never) ?? []) as FigureLike[];
  const fa = (effectiveFiguresOf(after as never) ?? []) as FigureLike[];

  const keys = new Set<string>();
  for (const f of [...fb, ...fa]) if (f.key) keys.add(f.key);
  // net/ordinary income são colunas próprias — entram sempre, mesmo fora de `figures`
  const figures: FigureDiff[] = [];
  const push = (key: string, label: string, b: number | null, a: number | null) => {
    if (b == null && a == null) return;
    const same = b != null && a != null && Math.abs(b - a) < 0.005;
    if (same) return;
    figures.push({ key, label, before: b, after: a, delta: b != null && a != null ? Math.round((a - b) * 100) / 100 : null });
  };

  push("NET_INCOME", "Resultado do exercício", num(before.netIncome), num(after.netIncome));
  push("ORDINARY_INCOME", "Ordinary income", num(before.ordinaryIncome), num(after.ordinaryIncome));
  for (const k of keys) {
    if (k === "NET_INCOME" || k === "ORDINARY_INCOME") continue;
    const b = fb.find((f) => f.key === k);
    const a = fa.find((f) => f.key === k);
    push(k, a?.label || b?.label || k, num(b?.value), num(a?.value));
  }

  // alocação por sócio: o que gera K-1 retificado
  type O = { name?: string; ownershipPct?: unknown; allocatedIncome?: unknown };
  const ob = (Array.isArray(before.owners) ? before.owners : []) as O[];
  const oa = (Array.isArray(after.owners) ? after.owners : []) as O[];
  const names = new Set<string>([...ob, ...oa].map((o) => (o.name ?? "").trim()).filter(Boolean));
  const owners: OwnerDiff[] = [];
  for (const name of names) {
    const b = ob.find((o) => (o.name ?? "").trim() === name);
    const a = oa.find((o) => (o.name ?? "").trim() === name);
    const bp = num(b?.ownershipPct);
    const ap = num(a?.ownershipPct);
    const bi = num(b?.allocatedIncome);
    const ai = num(a?.allocatedIncome);
    const samePct = bp != null && ap != null && Math.abs(bp - ap) < 0.005;
    const sameInc = bi != null && ai != null && Math.abs(bi - ai) < 0.005;
    if (samePct && sameInc) continue;
    owners.push({ name, beforePct: bp, afterPct: ap, beforeIncome: bi, afterIncome: ai });
  }

  return { figures, owners };
}
