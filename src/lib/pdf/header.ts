import { readFileSync } from "node:fs";
import path from "node:path";
import { rgb, type PDFDocument, type PDFPage, type PDFFont, type PDFImage } from "pdf-lib";

// Cabeçalho de marca padrão dos PDFs: logo da Vixus Global + título. Lê a logo de /public
// (incluída no deploy); se faltar, cai no wordmark em texto. Devolve o Y abaixo do cabeçalho.

let logoCache: Uint8Array | null | undefined;
function logoBytes(): Uint8Array | null {
  if (logoCache !== undefined) return logoCache;
  try {
    logoCache = new Uint8Array(readFileSync(path.join(process.cwd(), "public", "vixus-logo.png")));
  } catch {
    logoCache = null;
  }
  return logoCache;
}

// Embeda a logo no documento (uma vez) — null se não achar o arquivo.
export async function embedLogo(doc: PDFDocument): Promise<PDFImage | null> {
  const bytes = logoBytes();
  return bytes ? doc.embedPng(bytes) : null;
}

const NAVY = rgb(0.12, 0.23, 0.37);
const INK = rgb(0.12, 0.16, 0.22);
const GRAY = rgb(0.45, 0.48, 0.52);
const LINE = rgb(0.88, 0.9, 0.92);

export async function drawPdfHeader(
  doc: PDFDocument,
  page: PDFPage,
  fonts: { bold: PDFFont; font: PDFFont },
  opts: { title: string; subtitle?: string; right?: string; pageWidth: number; pageHeight: number; margin?: number; logoHeight?: number },
): Promise<number> {
  const M = opts.margin ?? 40;
  const top = opts.pageHeight - M;
  const bytes = logoBytes();

  let cursorY = top;
  if (bytes) {
    const img = await doc.embedPng(bytes);
    const h = opts.logoHeight ?? 22;
    const w = (img.width / img.height) * h;
    page.drawImage(img, { x: M, y: top - h, width: w, height: h });
    cursorY = top - h - 8;
  } else {
    page.drawText("VIXUS GLOBAL INVESTMENTS", { x: M, y: top - 6, size: 11, font: fonts.bold, color: NAVY });
    cursorY = top - 24;
  }

  if (opts.right) {
    const w = fonts.font.widthOfTextAtSize(opts.right, 8);
    page.drawText(opts.right, { x: opts.pageWidth - M - w, y: top - 4, size: 8, font: fonts.font, color: GRAY });
  }

  page.drawText(opts.title, { x: M, y: cursorY - 14, size: 15, font: fonts.bold, color: INK });
  let y = cursorY - 30;
  if (opts.subtitle) {
    page.drawText(opts.subtitle, { x: M, y, size: 9, font: fonts.font, color: GRAY });
    y -= 14;
  }
  page.drawLine({ start: { x: M, y: y - 2 }, end: { x: opts.pageWidth - M, y: y - 2 }, thickness: 0.5, color: LINE });
  return y - 16;
}
