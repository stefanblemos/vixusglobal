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
