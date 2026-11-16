/**
 * Inventory — leitor de invoice QuickBooks (Archway). Recebe os "text items" do pdf.js por
 * página (já extraídos no NAVEGADOR) e devolve as invoices do arquivo. Um PDF pode trazer
 * mais de uma invoice; páginas sem "INVOICE #", sem cabeçalho de tabela e sem totais são
 * anexos (comprovante de pagamento) e são puladas. Lê por POSIÇÃO (x/y), não pela ordem do
 * stream; cola glifos de fonte CID; separa o bloco de totais da metade esquerda da linha.
 * Armadilhas documentadas em CONTEXTO.md §6.1 do mock. Módulo puro (roda no cliente).
 */

export type PdfTextItem = { str: string; transform: number[]; width?: number; fontName?: string };

export type ParsedLine = { activity: string; desc: string[]; qty: number | null; rate: number | null; amount: number };
export type ParsedInvoice = {
  no: string | null;
  date: string | null; // MM/DD/YYYY como vem no PDF
  terms: string | null;
  lines: ParsedLine[];
  memo: string[];
  container: string | null;
  subtotal: number | null;
  discount: number;
  tax: number;
  total: number | null;
  payment: number | null;
  balance: number | null;
  pages: number;
};

type Cell = { s: string; x: number; y: number; w: number; xe: number; bold: boolean };
type Row = { y: number; cells: Cell[]; text: string };

const money = (s: string): number | null => {
  const v = parseFloat(String(s).replace(/[$,\s]/g, ""));
  return Number.isNaN(v) ? null : v;
};
const isNum = (s: string) => /^\(?-?\$?\s*[\d,]+(\.\d+)?\)?$/.test(String(s).trim()) && /\d/.test(s);
const TOT = /^(SUBTOTAL|DISCOUNT|TAX|TOTAL|PAYMENT|BALANCE DUE)$/i;

/** Agrupa os text items de UMA página em linhas por y (tolerância 1,6pt) e cola células vizinhas (vão < 1,2pt). */
export function rowsFromItems(items: PdfTextItem[], tol = 1.6, glue = 1.2): Row[] {
  const rows: { y: number; cells: Cell[] }[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const w = it.width || 0;
    const o: Cell = { s: it.str, x, y, w, xe: x + w, bold: /f2$|bold|-B$/i.test(it.fontName || "") };
    let r = rows.find((rr) => Math.abs(rr.y - o.y) <= tol);
    if (!r) {
      r = { y: o.y, cells: [] };
      rows.push(r);
    }
    r.cells.push(o);
  }
  const out: Row[] = [];
  for (const r of rows) {
    r.cells.sort((a, b) => a.x - b.x);
    const merged: Cell[] = [];
    for (const c of r.cells) {
      const p = merged[merged.length - 1];
      if (p && c.x - (p.x + p.w) < glue) {
        p.s += c.s;
        p.w = c.x + c.w - p.x;
        p.xe = p.x + p.w;
        p.bold = p.bold || c.bold;
      } else merged.push({ ...c });
    }
    const cells = merged.map((c) => ({ ...c, s: c.s.replace(/\s+/g, " ").trim() })).filter((c) => c.s);
    out.push({ y: r.y, cells, text: cells.map((c) => c.s).join(" ").replace(/\s+/g, " ").trim() });
  }
  out.sort((a, b) => b.y - a.y);
  return out;
}

function setTot(inv: ParsedInvoice, k: string, v: number) {
  if (k === "SUBTOTAL") inv.subtotal = v;
  else if (k === "DISCOUNT") inv.discount = v;
  else if (k === "TAX") inv.tax = v;
  else if (k === "TOTAL") inv.total = v;
  else if (k === "PAYMENT") inv.payment = v;
  else if (k === "BALANCE DUE") inv.balance = v;
}

/** pages = rowsFromItems(...) de cada página, na ordem. */
export function parseInvoicePages(pages: Row[][]): ParsedInvoice[] {
  const invs: ParsedInvoice[] = [];
  let inv!: ParsedInvoice;
  let started = false;
  let cols: { act: number; bQty: number; bRate: number; bAmt: number } | null = null;
  let cur: ParsedLine | null = null;
  let pending: string | null = null;
  const newInv = () => {
    inv = { no: null, date: null, terms: null, lines: [], memo: [], container: null, subtotal: null, discount: 0, tax: 0, total: null, payment: null, balance: null, pages: 0 };
    invs.push(inv);
    started = true;
    cols = null;
    cur = null;
  };

  for (const rows of pages) {
    const hasHead = rows.some((r) => r.cells.some((c) => /^ACTIVITY$/i.test(c.s)));
    const hasTot = rows.some((r) => r.cells.some((c) => TOT.test(c.s)));
    const hasNo = rows.some((r) => /INVOICE\s*#\s*\d/i.test(r.text));
    if (hasNo) newInv();
    if (!started) continue;
    if (!hasNo && !hasHead && !hasTot) continue; // anexo
    inv.pages++;

    for (const r of rows) {
      const h: Partial<Record<"act" | "qty" | "rate" | "amt", Cell>> = {};
      for (const c of r.cells) {
        if (/^ACTIVITY$/i.test(c.s)) h.act = c;
        else if (/^QTY$/i.test(c.s)) h.qty = c;
        else if (/^RATE$/i.test(c.s)) h.rate = c;
        else if (/^AMOUNT$/i.test(c.s)) h.amt = c;
      }
      if (h.act && h.qty && h.rate && h.amt) {
        cols = { act: h.act.x, bQty: h.qty.x - 8, bRate: (h.qty.xe + h.rate.x) / 2, bAmt: (h.rate.xe + h.amt.x) / 2 };
        continue;
      }
      const mNo = r.text.match(/INVOICE\s*#\s*(\d{3,8})/i);
      if (mNo) inv.no = mNo[1];
      const mDt = r.text.match(/\bDATE\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
      if (mDt) inv.date = mDt[1];
      const mTm = r.text.match(/\bTERMS\s+(.+?)\s*$/i);
      if (mTm) inv.terms = mTm[1];
      if (!cols) continue;

      const right = r.cells.filter((c) => c.x >= cols!.bQty);
      const left = r.cells.filter((c) => c.x < cols!.bQty);
      const txt = left.map((c) => c.s).join(" ").replace(/\s+/g, " ").trim();

      const tl = right.find((c) => TOT.test(c.s));
      const tv = right.filter((c) => c !== tl && isNum(c.s)).map((c) => money(c.s)).find((v) => v !== null);
      if (tl) {
        const k = tl.s.toUpperCase();
        if (tv !== undefined && tv !== null) setTot(inv, k, tv);
        else pending = k;
      } else if (pending && right.length && right.every((c) => isNum(c.s))) {
        const v = money(right[0].s);
        if (v !== null) setTot(inv, pending, v);
        pending = null;
      }
      const nums = right.filter((c) => !TOT.test(c.s) && isNum(c.s));
      const inTable = !!txt && left[0].x >= cols.act - 1.5;
      const hasAmt = nums.some((c) => c.xe >= cols!.bAmt);
      if (inTable && !tl && nums.length >= 1 && hasAmt) {
        let qty: number | null = null;
        let rate: number | null = null;
        let amount: number | null = null;
        for (const c of nums) {
          if (c.xe < cols.bRate) qty = money(c.s);
          else if (c.xe < cols.bAmt) rate = money(c.s);
          else amount = money(c.s);
        }
        if (amount === null) amount = money(nums[nums.length - 1].s) ?? 0;
        if (rate === null && qty) rate = +(amount / qty).toFixed(4);
        if (qty === null && rate) qty = +(amount / rate).toFixed(4);
        cur = { activity: txt, desc: [], qty, rate, amount };
        inv.lines.push(cur);
      } else if (txt) {
        if (!inTable || !cur) {
          inv.memo.push(txt);
          if (/^container/i.test(txt)) inv.container = txt.replace(/^container\s*:?\s*/i, "");
        } else cur.desc.push(txt);
      }
    }
  }
  for (const v of invs) {
    for (const l of v.lines) while (l.desc.length && /^new$/i.test(l.desc[0])) l.activity += " " + l.desc.shift();
    if (v.total == null) v.total = (v.subtotal ?? 0) + (v.discount ?? 0) + (v.tax ?? 0);
  }
  return invs.filter((v) => v.lines.length);
}

/** Soma das linhas + desconto + tax fecha com o total? */
export function linesClose(inv: ParsedInvoice): boolean {
  const sum = inv.lines.reduce((s, l) => s + (l.amount ?? 0), 0) + (inv.discount ?? 0) + (inv.tax ?? 0);
  return inv.total != null && Math.abs(sum - inv.total) < 0.05;
}

/** "MM/DD/YYYY" → "YYYY-MM-DD". */
export function usDateToIso(s: string | null): string | null {
  const m = String(s ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}
