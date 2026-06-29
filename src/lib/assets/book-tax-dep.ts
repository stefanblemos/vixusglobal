// Helpers compartilhados de depreciação livro→fiscal. FONTE ÚNICA para Tax preview, Reserve e
// Quarterly, para que os três calculem a base tributável do MESMO jeito (sem divergência).
//
// Princípio (decidido p/ a Truss): CONFIA no livro. Se o P&L já tem depreciação, ela já está no
// lucro — não trocamos pela MACRS nem inflamos pela diferença (isso vira só flag na Conferência).
// A MACRS do app só entra na base quando o livro NÃO tem depreciação (preenche a lacuna).

const r2 = (n: number) => Math.round(n * 100) / 100;

type PnlLine = { lineType: string; label: string; value: unknown };

// Depreciação contábil (book) lançada no P&L — exclui "accumulated/acumulada". Conta DEPRECIAÇÃO
// (inclui a linha combinada "Depreciation & Amortization", que tem depreciação), mas NÃO a
// amortização PURA de intangíveis: a MACRS do app é só de ativos fixos, então se o livro tem apenas
// amortização (sem depreciação), os ativos fixos ainda precisam da MACRS na base (antes era suprimida).
export function bookDepFromLines(lines: PnlLine[]): number {
  let sum = 0;
  for (const l of lines) {
    if (l.lineType !== "ACCOUNT" || l.value == null) continue;
    if (/deprecia/i.test(l.label) && !/accumulated|acumulad/i.test(l.label)) {
      sum += Math.abs(Number(l.value));
    }
  }
  return r2(sum);
}

// Ajuste de depreciação a SOMAR ao lucro contábil: taxableProfit = bookProfit + ajuste.
//  • livro já tem depreciação → 0 (confia no livro);
//  • livro sem depreciação e há ativos → −macrsDep (aplica a MACRS como dedução);
//  • sem ativos → 0.
export function trustBookDepAdjustment(bookDep: number, macrsDep: number, hasAssets: boolean): number {
  if (!hasAssets) return 0;
  if (bookDep > 0.005) return 0;
  return -r2(macrsDep);
}

// true quando a MACRS foi aplicada na base (livro sem depreciação) — para flag na UI.
export function macrsAppliedToBase(bookDep: number, macrsDep: number, hasAssets: boolean): boolean {
  return hasAssets && bookDep <= 0.005 && macrsDep > 0.005;
}
