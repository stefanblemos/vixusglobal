import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import { buildClosingSequence, type SeqNode } from "./sequence";
import { drawPdfHeader } from "@/lib/pdf/header";

// PDF da sequência de fechamento do IR (para enviar ao contador). Logo Vixus no topo,
// alertas de fora-de-ordem, e cada passo com as entidades + "repassa para" + "depende de".

const W = 595,
  H = 842,
  M = 40;
const INK = rgb(0.12, 0.16, 0.22);
const GRAY = rgb(0.42, 0.45, 0.5);
const GREEN = rgb(0.13, 0.55, 0.27);
const SKY = rgb(0.1, 0.4, 0.6);
const RED = rgb(0.8, 0.15, 0.23);
const LINE = rgb(0.9, 0.91, 0.93);

const clean = (s: string) =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E·]/g, "");

const statusText: Record<string, string> = { done: "fechado", ready: "pronta p/ fechar", blocked: "aguardando" };

export async function buildSequencePdf(year: number, generatedLabel?: string): Promise<Uint8Array> {
  const seq = await buildClosingSequence(year);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([W, H]);
  let y = await drawPdfHeader(doc, page, { bold, font }, {
    title: `Closing sequence — ${year}`,
    subtitle: "Ordem de fechamento do IR seguindo a arvore pass-through (feche do passo 1 ao ultimo).",
    right: generatedLabel ? `Generated ${generatedLabel}` : undefined,
    pageWidth: W,
    pageHeight: H,
  });

  const ensure = (need: number) => {
    if (y - need < M) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  };
  const text = (s: string, x: number, size: number, f = font, color = INK) =>
    page.drawText(clean(s), { x, y, size, font: f, color });
  const wrap = (s: string, max: number, size: number) => {
    const out: string[] = [];
    let line = "";
    for (const word of clean(s).split(/\s+/)) {
      const trial = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(trial, size) > max && line) {
        out.push(line);
        line = word;
      } else line = trial;
    }
    if (line) out.push(line);
    return out;
  };

  // Alertas de fora-de-ordem
  if (seq.outOfOrder.length) {
    ensure(20);
    text(`Atencao - fechou fora de ordem (${seq.outOfOrder.length}): confira se o K-1 entrou`, M, 10, bold, RED);
    y -= 16;
    for (const n of seq.outOfOrder) {
      for (const ln of wrap(`- ${n.name}: fechou, mas falta fechar ${n.outOfOrder.join(", ")}`, W - 2 * M - 10, 9)) {
        ensure(13);
        text(ln, M + 10, 9, font, RED);
        y -= 13;
      }
    }
    y -= 8;
  }

  // Passos
  seq.tiers.forEach((tier, i) => {
    ensure(22);
    page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 18, color: rgb(0.96, 0.97, 0.98) });
    text(`Passo ${i + 1}`, M + 6, 10, bold, INK);
    y -= 22;
    for (const n of tier) {
      ensure(40);
      const stColor = n.status === "done" ? GREEN : n.status === "ready" ? SKY : GRAY;
      const tag = n.finalPayer ? `  [${n.kind === "person" ? "1040" : "C-corp"} - final]` : "";
      text(`${n.name}  (${n.acronym})${tag}`, M + 6, 10, bold, INK);
      const st = statusText[n.status] ?? n.status;
      const stw = font.widthOfTextAtSize(st, 9);
      page.drawText(st, { x: W - M - stw, y, size: 9, font, color: stColor });
      y -= 13;
      if (n.passesTo.length) {
        const ptxt = "repassa para: " + n.passesTo.map((r) => `${r.acronym} ${r.pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`).join(" · ");
        for (const ln of wrap(ptxt, W - 2 * M - 12, 8.5)) {
          ensure(12);
          text(ln, M + 12, 8.5, font, GRAY);
          y -= 12;
        }
      } else if (n.finalPayer) {
        ensure(12);
        text("pagador final (nao repassa)", M + 12, 8.5, font, GRAY);
        y -= 12;
      }
      if (n.deps.length) {
        const dtxt = "depende de: " + n.deps.map((d) => `${d.name}${d.done ? " (ok)" : ""}`).join(", ");
        for (const ln of wrap(dtxt, W - 2 * M - 12, 8.5)) {
          ensure(12);
          text(ln, M + 12, 8.5, font, GRAY);
          y -= 12;
        }
      }
      y -= 4;
      page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.3, color: LINE });
    }
    y -= 6;
  });

  ensure(14);
  text("(ok) = investida ja fechada.  Pagador final = C-corp ou PF (1040).", M, 8, font, GRAY);

  return doc.save();
}
