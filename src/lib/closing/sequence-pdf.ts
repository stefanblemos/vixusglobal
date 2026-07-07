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
const NAVY = rgb(0.12, 0.23, 0.37);
const WHITE = rgb(1, 1, 1);
const GREEN = rgb(0.13, 0.5, 0.27);
const GREEN_BG = rgb(0.87, 0.95, 0.88);
const SKY = rgb(0.09, 0.4, 0.62);
const SKY_BG = rgb(0.86, 0.93, 0.99);
const AMBER = rgb(0.72, 0.5, 0.05);
const AMBER_BG = rgb(0.99, 0.95, 0.82);
const RED = rgb(0.78, 0.13, 0.2);
const RED_BG = rgb(0.99, 0.9, 0.9);
const LINE = rgb(0.9, 0.91, 0.93);

const clean = (s: string) =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E·]/g, "");

const statusText: Record<string, string> = { done: "fechado", ready: "pronta p/ fechar", blocked: "aguardando" };
// Cor do badge de status: verde (fechado), azul (pronta), ambar (aguardando).
const statusPill: Record<string, { fg: ReturnType<typeof rgb>; bg: ReturnType<typeof rgb> }> = {
  done: { fg: GREEN, bg: GREEN_BG },
  ready: { fg: SKY, bg: SKY_BG },
  blocked: { fg: AMBER, bg: AMBER_BG },
};

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
    logoHeight: 32,
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
  // Badge (pill) colorido alinhado à direita, na linha atual.
  const pill = (label: string, fg: ReturnType<typeof rgb>, bg: ReturnType<typeof rgb>, rightEdge = W - M) => {
    const s = clean(label);
    const tw = bold.widthOfTextAtSize(s, 8.5);
    const padX = 6;
    const x = rightEdge - tw - 2 * padX;
    page.drawRectangle({ x, y: y - 3, width: tw + 2 * padX, height: 15, color: bg });
    page.drawText(s, { x: x + padX, y: y + 1, size: 8.5, font: bold, color: fg });
    return x; // borda esquerda do pill (p/ encadear outro à esquerda)
  };
  // Marcador quadrado colorido (bullet) usado nas dependências.
  const bullet = (cx: number, color: ReturnType<typeof rgb>) =>
    page.drawRectangle({ x: cx, y: y + 1, width: 5, height: 5, color });

  // Legenda de cores
  ensure(16);
  text("Legenda:", M, 8.5, bold, GRAY);
  bullet(M + 48, GREEN);
  text("dependencia fechada (ok)", M + 58, 8.5, font, GREEN);
  bullet(M + 200, RED);
  text("falta fechar antes", M + 210, 8.5, font, RED);
  y -= 18;

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
    ensure(24);
    page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 18, color: NAVY });
    text(`PASSO ${i + 1}`, M + 8, 10, bold, WHITE);
    y -= 24;
    for (const n of tier) {
      // Dependências ainda abertas primeiro (evidencia o que falta), depois as ok.
      const deps = [...n.deps].sort((a, b) => Number(a.done) - Number(b.done) || a.name.localeCompare(b.name));
      const openDeps = deps.filter((d) => !d.done);
      const depLines = 12 * deps.length;
      ensure(30 + depLines);

      const tag = n.disregardedInto
        ? `  [disregarded -> ${n.disregardedInto}]`
        : n.finalPayer ? `  [${n.kind === "person" ? "1040" : "C-corp"} - final]` : "";
      text(`${n.name}  (${n.acronym})${tag}`, M + 6, 10, bold, n.disregardedInto ? SKY : INK);
      // Badge de status à direita; se fechou fora de ordem, um badge "REVISAR" vermelho à esquerda dele.
      const p = statusPill[n.status] ?? { fg: GRAY, bg: LINE };
      const left = pill(statusText[n.status] ?? n.status, p.fg, p.bg);
      if (n.outOfOrder.length > 0) pill("REVISAR", RED, RED_BG, left - 5);
      y -= 14;

      if (n.disregardedInto) {
        ensure(12);
        text(`fecha os LIVROS (sem IR proprio) - consolida no IR de ${n.disregardedInto}`, M + 12, 8.5, font, SKY);
        y -= 12;
      } else if (n.passesTo.length) {
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

      if (deps.length) {
        ensure(12);
        const head = openDeps.length
          ? `depende de (falta fechar ${openDeps.length} de ${deps.length}):`
          : `depende de (todas fechadas):`;
        text(head, M + 12, 8.5, font, openDeps.length ? RED : GREEN);
        y -= 12;
        // Uma dependencia por linha: verde = ja fechada, vermelho = ainda aberta.
        for (const d of deps) {
          ensure(12);
          const col = d.done ? GREEN : RED;
          bullet(M + 20, col);
          const suffix = d.done ? "  (fechada)" : "  (ainda aberta)";
          for (const [k, ln] of wrap(`${d.name}${suffix}`, W - 2 * M - 34, 8.5).entries()) {
            if (k > 0) ensure(12);
            text(ln, M + 30, 8.5, font, col);
            y -= 12;
          }
        }
      }
      y -= 4;
      page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.3, color: LINE });
    }
    y -= 6;
  });

  ensure(14);
  text("Verde = investida ja fechada.  Vermelho = falta fechar antes desta.  Pagador final = C-corp ou PF (1040).", M, 8, font, GRAY);

  return doc.save();
}
