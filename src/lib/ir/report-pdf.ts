import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Renderiza um texto (o report ao contador) num PDF A4 simples, com quebra de linha.
export async function textToPdf(title: string, body: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = 595,
    H = 842,
    M = 56,
    SIZE = 10.5,
    LH = 15.5;
  const maxW = W - 2 * M;
  const INK = rgb(0.12, 0.16, 0.22);

  // Sanitiza p/ WinAnsi (pdf-lib não codifica alguns unicode) e quebra em linhas.
  const clean = (s: string) =>
    s
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-")
      .replace(/≈/g, "~")
      .replace(/[^\x20-\x7E\n]/g, "");

  const wrap = (text: string): string[] => {
    const out: string[] = [];
    for (const raw of clean(text).split("\n")) {
      if (raw.trim() === "") {
        out.push("");
        continue;
      }
      let line = "";
      for (const word of raw.split(/\s+/)) {
        const trial = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(trial, SIZE) > maxW && line) {
          out.push(line);
          line = word;
        } else line = trial;
      }
      if (line) out.push(line);
    }
    return out;
  };

  let page = doc.addPage([W, H]);
  let y = H - M;
  page.drawText(clean(title), { x: M, y, size: 13, font: bold, color: INK });
  y -= 26;

  for (const line of wrap(body)) {
    if (y < M) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
    page.drawText(line, { x: M, y, size: SIZE, font, color: INK });
    y -= LH;
  }

  return doc.save();
}
