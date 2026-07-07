// FONTE ÚNICA das figuras efetivas de um IR: as lidas pela IA (`figures`) com os ajustes MANUAIS
// auditáveis (`manualFigures`) sobrepostos por `key`. TODO consumidor de figuras do IR deve usar
// isto — senão um ajuste manual (ex.: depreciação que estava no IR mas não foi destacada) é
// ignorado em umas telas e aplicado em outras (múltiplas fontes de verdade).

export type IrFigure = { key: string; label: string; value: number | null; line: string | null };

export function effectiveFigures(figures: unknown, manualFigures: unknown): IrFigure[] {
  const parsed = (figures as IrFigure[] | null) ?? [];
  const manual = (manualFigures as IrFigure[] | null) ?? [];
  if (!manual.length) return parsed;
  const keys = new Set(manual.map((m) => m.key));
  return [...parsed.filter((f) => !keys.has(f.key)), ...manual];
}

// Atalho para quando se tem o objeto do retorno (com os dois campos).
export function effectiveFiguresOf(ret: { figures?: unknown; manualFigures?: unknown }): IrFigure[] {
  return effectiveFigures(ret.figures ?? null, ret.manualFigures ?? null);
}

// Soma as figuras de VÁRIOS IRs do mesmo ano/empresa por `key` — para conversão de tipo no meio do
// ano (ex.: 4U trocou S-corp→partnership em 2025: dois IRs de período curto cujas figuras de FLUXO —
// renda, deduções, imposto — se completam no ano). Para 1 IR (o caso normal) é IDENTIDADE (devolve as
// próprias figuras, sem mudar nada). Figuras de estoque (capital account) NÃO passam por aqui — a base
// distribuível usa a do IR final (partnership), tratada à parte.
export function sumFiguresByKey(figureLists: IrFigure[][]): IrFigure[] {
  if (figureLists.length === 1) return figureLists[0];
  const byKey = new Map<string, IrFigure>();
  for (const list of figureLists) {
    for (const f of list) {
      if (f.value == null) continue;
      const cur = byKey.get(f.key);
      if (cur) cur.value = (cur.value ?? 0) + Number(f.value);
      else byKey.set(f.key, { ...f, value: Number(f.value) });
    }
  }
  return [...byKey.values()];
}

// Figuras efetivas por empresa, SOMANDO os IRs do mesmo ano (conversão de tipo). 1 IR por empresa =
// idêntico ao de antes. Usado pela Conferência IR, M-1 e selo de confiança (camada de comparação).
export function figuresByCompany(
  rets: { companyId: string | null; figures?: unknown; manualFigures?: unknown }[],
): Map<string, IrFigure[]> {
  const groups = new Map<string, IrFigure[][]>();
  for (const r of rets) {
    if (!r.companyId) continue;
    (groups.get(r.companyId) ?? groups.set(r.companyId, []).get(r.companyId)!).push(effectiveFiguresOf(r));
  }
  const out = new Map<string, IrFigure[]>();
  for (const [cid, lists] of groups) out.set(cid, sumFiguresByKey(lists));
  return out;
}
