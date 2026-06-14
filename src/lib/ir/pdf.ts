import { PDFDocument } from "pdf-lib";

// A Claude processa PDFs de até ~100 páginas. Para IRs grandes (com anexos),
// mantém as primeiras `max` páginas (formulário principal + K-1 + 4562).
export async function clampPdfPages(
  buf: Buffer,
  max = 100,
): Promise<{ buf: Buffer; total: number; clamped: boolean }> {
  try {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const total = src.getPageCount();
    if (total <= max) return { buf, total, clamped: false };
    const out = await PDFDocument.create();
    const pages = await out.copyPages(
      src,
      Array.from({ length: max }, (_, i) => i),
    );
    pages.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    return { buf: Buffer.from(bytes), total, clamped: true };
  } catch {
    // PDF que o pdf-lib não consegue abrir: envia como veio.
    return { buf, total: 0, clamped: false };
  }
}
