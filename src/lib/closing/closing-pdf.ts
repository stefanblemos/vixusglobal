import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import { buildCompleteness, type CompletenessRow, type Cell } from "./completeness";
import { embedLogo } from "@/lib/pdf/header";

// PDF da matriz de fechamento (closing) — para enviar ao contador mostrando o que
// ainda falta por empresa. Layout: paisagem Letter, uma linha por empresa.

type Status = "ok" | "partial" | "missing" | "na";

const COLS = [
  { key: "ir", label: "Return (IR)", w: 78 },
  { key: "pnl", label: "P&L", w: 60 },
  { key: "bs", label: "Balance Sheet", w: 92 },
  { key: "gl", label: "General Ledger", w: 100 },
  { key: "bank", label: "Bank", w: 64 },
] as const;
const NAME_W = 250;
const DONE_W = 68;

const PAGE_W = 792;
const PAGE_H = 612;
const M = 40;
const ROW_H = 22;

const GREEN = rgb(0.13, 0.55, 0.27);
const RED = rgb(0.8, 0.15, 0.23);
const AMBER = rgb(0.72, 0.45, 0.05);
const GRAY = rgb(0.55, 0.58, 0.62);
const INK = rgb(0.12, 0.16, 0.22);
const NAVY = rgb(0.12, 0.23, 0.37);
const LINE = rgb(0.88, 0.9, 0.92);
const HEADBG = rgb(0.96, 0.97, 0.98);

const cellStatus = (c: Cell): Status => (c.ok ? "ok" : c.partial ? "partial" : "missing");

function statusFor(r: CompletenessRow, key: (typeof COLS)[number]["key"]): Status {
  if (!r.existed) return "na";
  if (r.windDown) return key === "ir" ? cellStatus(r.ir) : "na";
  return cellStatus(r[key]);
}

export async function buildClosingPdf(year: number, generatedLabel?: string): Promise<Uint8Array> {
  const { rows } = await buildCompleteness(year);
  const existing = rows.filter((r) => r.existed);
  const isDone = (r: CompletenessRow) => (r.windDown ? r.ir.ok : r.complete === COLS.length);
  const fullyComplete = existing.filter(isDone).length;
  const missingByCol = COLS.map((c) => ({
    label: c.label,
    missing: existing.filter((r) => !r[c.key].ok && !(r.windDown && c.key !== "ir")).length,
  }));

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(doc);

  // posições x das colunas
  const xName = M;
  const colX: number[] = [];
  let x = xName + NAME_W;
  for (const c of COLS) {
    colX.push(x);
    x += c.w;
  }
  const xDone = x;

  const center = (page: PDFPage, text: string, f: PDFFont, size: number, color: ReturnType<typeof rgb>, cx: number, cw: number, y: number) => {
    const w = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: cx + (cw - w) / 2, y, size, font: f, color });
  };
  const drawCheck = (page: PDFPage, cx: number, cw: number, y: number) => {
    const mx = cx + cw / 2 - 3;
    page.drawLine({ start: { x: mx, y: y + 1 }, end: { x: mx + 3, y: y - 2 }, thickness: 1.6, color: GREEN });
    page.drawLine({ start: { x: mx + 3, y: y - 2 }, end: { x: mx + 8, y: y + 5 }, thickness: 1.6, color: GREEN });
  };
  const drawStatus = (page: PDFPage, s: Status, cx: number, cw: number, y: number) => {
    if (s === "ok") return drawCheck(page, cx, cw, y);
    const [txt, color] = s === "partial" ? ["partial", AMBER] : s === "na" ? ["N/A", GRAY] : ["missing", RED];
    center(page, txt, font, 8.5, color, cx, cw, y);
  };
  const ellipsize = (text: string, max: number, size: number) => {
    if (font.widthOfTextAtSize(text, size) <= max) return text;
    let t = text;
    while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > max) t = t.slice(0, -1);
    return t + "…";
  };

  let page!: PDFPage;
  let y = 0;
  let pageNum = 0;

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pageNum += 1;
    // Cabeçalho do documento — logo Vixus (ou wordmark se faltar)
    if (logo) {
      const h = 20;
      page.drawImage(logo, { x: M, y: PAGE_H - M - h + 8, width: (logo.width / logo.height) * h, height: h });
    } else {
      page.drawText("VIXUS GLOBAL INVESTMENTS", { x: M, y: PAGE_H - M, size: 11, font: bold, color: NAVY });
    }
    page.drawText(`Closing — completeness  ·  ${year}`, { x: M, y: PAGE_H - M - 20, size: 16, font: bold, color: INK });
    const stamp = `${fullyComplete} / ${existing.length} complete   ·   ${missingByCol
      .filter((m) => m.missing > 0)
      .map((m) => `${m.missing} missing ${m.label}`)
      .join("   ·   ")}`;
    page.drawText(stamp, { x: M, y: PAGE_H - M - 38, size: 9, font, color: GRAY });
    if (generatedLabel) {
      const g = `Generated ${generatedLabel}`;
      page.drawText(g, { x: PAGE_W - M - font.widthOfTextAtSize(g, 8), y: PAGE_H - M, size: 8, font, color: GRAY });
    }

    // Cabeçalho da tabela
    y = PAGE_H - M - 60;
    page.drawRectangle({ x: M, y: y - 6, width: PAGE_W - 2 * M, height: ROW_H, color: HEADBG });
    page.drawText("Company", { x: xName + 4, y: y + 1, size: 9, font: bold, color: INK });
    COLS.forEach((c, i) => center(page, c.label, bold, 8.5, INK, colX[i], c.w, y + 1));
    center(page, "Complete", bold, 8.5, INK, xDone, DONE_W, y + 1);
    y -= ROW_H;
  };

  newPage();

  for (const r of rows) {
    if (y < M + 40) {
      // rodapé e nova página
      page.drawText(`Page ${pageNum}`, { x: PAGE_W - M - 40, y: M - 10, size: 8, font, color: GRAY });
      newPage();
    }
    // nome (cinza se não existia no ano)
    const nameColor = r.existed ? INK : GRAY;
    page.drawText(ellipsize(r.companyName, NAME_W - 8, 9), { x: xName + 4, y: y + 1, size: 9, font, color: nameColor });

    if (!r.existed) {
      const msg = r.closingYear != null && year > r.closingYear ? `N/A — closed in ${r.closingYear}` : `N/A — not yet incorporated`;
      page.drawText(msg, { x: colX[0] + 4, y: y + 1, size: 8.5, font, color: GRAY });
    } else {
      COLS.forEach((c, i) => drawStatus(page, statusFor(r, c.key), colX[i], c.w, y + 1));
      // coluna Complete
      let txt: string, color: ReturnType<typeof rgb>;
      if (r.windDown) {
        txt = r.ir.ok ? "final IR" : "IR missing";
        color = r.ir.ok ? GREEN : RED;
      } else {
        txt = `${r.complete}/${COLS.length}`;
        color = r.complete === COLS.length ? GREEN : r.complete === 0 ? RED : AMBER;
      }
      center(page, txt, bold, 8.5, color, xDone, DONE_W, y + 1);
    }

    page.drawLine({ start: { x: M, y: y - 6 }, end: { x: PAGE_W - M, y: y - 6 }, thickness: 0.5, color: LINE });
    y -= ROW_H;
  }

  // Legenda + rodapé
  y -= 6;
  drawCheck(page, M - 2, 12, y);
  page.drawText("on file        partial = GL doesn't cover the full year        missing = not on file        N/A = not applicable", {
    x: M + 14, y: y - 1, size: 8, font, color: GRAY,
  });
  page.drawText(`Page ${pageNum}`, { x: PAGE_W - M - 40, y: M - 10, size: 8, font, color: GRAY });

  return doc.save();
}
