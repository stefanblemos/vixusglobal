import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from "docx";
import type { ReportData } from "@/lib/pools/report-data";
import type { ReportProse } from "@/lib/pools/report-ai";
import { LOGO_4U, LOGO_VIXUS } from "@/lib/pools/report-logos";
import { daysToMonths } from "@/lib/pools/phases";

// Investment Summary canônico por simulação — prosa aprovada pelo Stefan em 13/07/2026
// (rascunho validado com o advogado). Texto fixo em inglês; números vêm do ReportData.

const NAVY = "1F3A5F";
const GRAY = "6B7280";
const FONT = "Arial";
const W = 9360; // 6.5" de conteúdo em DXA

const money0 = (v: number) =>
  (v < 0 ? "−$" : "$") + Math.round(Math.abs(v)).toLocaleString("en-US");
const money2 = (v: number) =>
  (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number | null, digits = 1) => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);
const months = (days: number) => Math.ceil(days / 30);

const t = (text: string, opts: Record<string, unknown> = {}) =>
  new TextRun({ text, font: FONT, size: 22, ...opts });

const body = (children: string | TextRun[], opts: Record<string, unknown> = {}) =>
  new Paragraph({
    // corpo do documento justificado (padrão institucional) — opts pode sobrescrever
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 160, line: 288 },
    children: Array.isArray(children) ? children : [t(children)],
    ...opts,
  });

const h1 = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 200 },
    children: [new TextRun({ text, font: FONT, size: 30, bold: true, color: NAVY })],
  });

const h2 = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 140 },
    children: [new TextRun({ text, font: FONT, size: 24, bold: true, color: NAVY })],
  });

const bullet = (children: string | TextRun[]) =>
  new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 100, line: 276 },
    children: Array.isArray(children) ? children : [t(children)],
  });

function kvTable(rows: Array<[string, string | TextRun[]]>, c1 = 3200) {
  const c2 = W - c1;
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [c1, c2],
    rows: rows.map(
      ([k, v]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: c1, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, fill: "F1F5F9" },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [new Paragraph({ children: [t(k, { bold: true, size: 20 })] })],
            }),
            new TableCell({
              width: { size: c2, type: WidthType.DXA },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [
                new Paragraph({ children: Array.isArray(v) ? v : [t(v, { size: 20 })] }),
              ],
            }),
          ],
        }),
    ),
  });
}

function gridTable(header: string[], rows: (string | TextRun)[][], widths: number[], opts?: { boldLastRow?: boolean }) {
  const mk = (cells: (string | TextRun)[], isHeader: boolean, isLast: boolean) =>
    new TableRow({
      tableHeader: isHeader,
      children: cells.map(
        (c, i) =>
          new TableCell({
            width: { size: widths[i], type: WidthType.DXA },
            shading: isHeader ? { type: ShadingType.CLEAR, fill: NAVY } : undefined,
            margins: { top: 70, bottom: 70, left: 110, right: 110 },
            children: [
              new Paragraph({
                alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT,
                children: [
                  typeof c === "string"
                    ? t(c, {
                        size: 19,
                        bold: isHeader || (isLast && opts?.boldLastRow),
                        color: isHeader ? "FFFFFF" : undefined,
                      })
                    : c,
                ],
              }),
            ],
          }),
      ),
    });
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      mk(header, true, false),
      ...rows.map((r, i) => mk(r, false, i === rows.length - 1)),
    ],
  });
}

// Bloco de retorno do Executive Summary (aprovado 15/07): Expected em navy, Downside e
// Upside ao lado — a primeira coisa que o investidor lê é o caso esperado, não o stress.
function kpiStrip(cells: Array<{ label: string; value: string; sub: string; main?: boolean }>) {
  const mainW = 3600;
  const sideW = Math.floor((W - mainW) / Math.max(1, cells.length - 1));
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: cells.map((c) => (c.main ? mainW : sideW)),
    rows: [
      new TableRow({
        children: cells.map(
          (c) =>
            new TableCell({
              width: { size: c.main ? mainW : sideW, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, fill: c.main ? NAVY : "F8FAFC" },
              margins: { top: 160, bottom: 160, left: 160, right: 160 },
              children: [
                new Paragraph({
                  children: [t(c.label.toUpperCase(), { size: 14, bold: true, color: c.main ? "B9C6DA" : GRAY })],
                }),
                new Paragraph({
                  spacing: { before: 60 },
                  children: [t(c.value, { size: c.main ? 44 : 34, bold: true, color: c.main ? "FFFFFF" : "0F172A" })],
                }),
                new Paragraph({
                  spacing: { before: 60 },
                  children: [t(c.sub, { size: 14, italics: true, color: c.main ? "B9C6DA" : GRAY })],
                }),
              ],
            }),
        ),
      }),
    ],
  });
}

// Grade de números grandes do track record (feedback 15/07: "sem muito texto, só números")
function bigStatGrid(stats: Array<{ value: string; label: string }>) {
  const cw = Math.floor(W / stats.length);
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: stats.map(() => cw),
    rows: [
      new TableRow({
        children: stats.map(
          (s) =>
            new TableCell({
              width: { size: cw, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, fill: "F8FAFC" },
              margins: { top: 260, bottom: 260, left: 120, right: 120 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [t(s.value, { size: 52, bold: true, color: NAVY })],
                }),
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 60 },
                  children: [t(s.label.toUpperCase(), { size: 15, bold: true, color: GRAY })],
                }),
              ],
            }),
        ),
      }),
    ],
  });
}

// Timeline visual do §5 (feedback 15/07) — Gantt em tabela: uma coluna por mês, células
// pintadas onde a fase tem SEGMENTO ativo (gaps da esteira aparecem em branco, como no app)
function ganttTable(pp: ReportData["projectPhases"]) {
  const M = Math.max(1, Math.ceil(pp.totalDays / 30));
  const labelW = 2000;
  const cellW = Math.floor((W - labelW) / M);
  const EN: Record<string, string> = { lots: "Lots", permits: "Permits", build: "Construction", sales: "Sales" };
  const COLOR: Record<string, string> = {
    lots: "A3B18A",
    permits: "94A3B8",
    build: "F59E0B",
    sales: "22C55E",
    loan: NAVY,
  };
  const rows: Array<{ key: string; label: string; segments: Array<[number, number]> }> = [
    ...pp.phases.map((p) => ({ key: p.key, label: EN[p.key] ?? p.label, segments: p.segments })),
    ...(pp.loan ? [{ key: "loan", label: "Loan outstanding", segments: pp.loan.segments }] : []),
  ];
  const cell = (fill: string, w: number, text = "") =>
    new TableCell({
      width: { size: w, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill },
      margins: { top: 30, bottom: 30, left: 20, right: 20 },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [t(text, { size: 12, color: GRAY })] }),
      ],
    });
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [labelW, ...Array.from({ length: M }, () => cellW)],
    rows: [
      new TableRow({
        children: [
          cell("FFFFFF", labelW, "Month"),
          ...Array.from({ length: M }, (_, i) =>
            cell("FFFFFF", cellW, M <= 14 || (i + 1) % 3 === 1 || i === M - 1 ? String(i + 1) : ""),
          ),
        ],
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: [
              new TableCell({
                width: { size: labelW, type: WidthType.DXA },
                margins: { top: 30, bottom: 30, left: 80, right: 40 },
                children: [new Paragraph({ children: [t(r.label, { size: 16, bold: true, color: "475569" })] })],
              }),
              ...Array.from({ length: M }, (_, i) => {
                const a = i * 30;
                const b = (i + 1) * 30;
                const active = r.segments.some(([s0, s1]) => s0 < b && s1 > a);
                return cell(active ? COLOR[r.key] : "F1F5F9", cellW);
              }),
            ],
          }),
      ),
    ],
  });
}

// Ficha "The homes in this program" (mock aprovado 15/07): foto + specs + linha de
// underwriting (preço da simulação, $/SF, percentil do §3). Layout A = 1 modelo (card
// cheio, foto à esquerda); Layout B = 2+ modelos (grade compacta, 2 por linha).
type ModelCard = ReportData["modelCards"][number];

const cardImage = (c: ModelCard, imgW: number) =>
  new ImageRun({
    type: c.dataUri.startsWith("data:image/png") ? "png" : "jpg",
    data: Buffer.from(c.dataUri.slice(c.dataUri.indexOf(",") + 1), "base64"),
    transformation: { width: imgW, height: Math.max(1, Math.round((imgW * c.height) / c.width)) },
  });

const specLineOf = (c: ModelCard) =>
  [
    c.beds != null ? `${c.beds} bed` : null,
    c.baths != null ? `${c.baths} bath` : null,
    c.garage != null ? `${c.garage}-car garage` : null,
    c.livingSqft != null ? `${c.livingSqft.toLocaleString("en-US")} SF living` : null,
    c.builtSqft != null ? `${c.builtSqft.toLocaleString("en-US")} SF built` : null,
  ]
    .filter(Boolean)
    .join(" · ");

const underwritingOf = (c: ModelCard) =>
  `Sale price ${money0(c.salePrice)}` +
  (c.ppsf != null ? ` · $${c.ppsf}/SF living` : "") +
  (c.percentile != null
    ? ` — P${c.percentile} of closed new-construction sales in ${c.locations.join(", ")} (Section 3)`
    : ` — ${c.locations.join(", ")}`);

function modelCardsBlock(cards: ReportData["modelCards"]): (Paragraph | Table)[] {
  const NO_BORDERS = {
    top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  };

  if (cards.length === 1) {
    // Layout A — card cheio: foto à esquerda, painel de specs à direita
    const c = cards[0];
    const photoW = 5100;
    const panelW = W - photoW;
    const spec = (v: string, l: string) =>
      new TableCell({
        width: { size: Math.floor((panelW - 320) / 2), type: WidthType.DXA },
        margins: { top: 40, bottom: 40, left: 0, right: 60 },
        children: [
          new Paragraph({ children: [t(v, { size: 21, bold: true, color: "0F172A" })] }),
          new Paragraph({ children: [t(l.toUpperCase(), { size: 12, color: GRAY })] }),
        ],
      });
    const specCells: TableCell[] = [];
    if (c.beds != null) specCells.push(spec(String(c.beds), "Bedrooms"));
    if (c.baths != null) specCells.push(spec(String(c.baths), "Bathrooms"));
    if (c.livingSqft != null) specCells.push(spec(`${c.livingSqft.toLocaleString("en-US")} SF`, "Living area"));
    if (c.builtSqft != null) specCells.push(spec(`${c.builtSqft.toLocaleString("en-US")} SF`, "Built area"));
    if (c.garage != null) specCells.push(spec(`${c.garage}-car`, "Garage"));
    if (c.buildMonths > 0) specCells.push(spec(`${c.buildMonths} mo`, "Build time"));
    const specRows: TableRow[] = [];
    for (let i = 0; i < specCells.length; i += 2) {
      specRows.push(
        new TableRow({ children: [specCells[i], ...(specCells[i + 1] ? [specCells[i + 1]] : [])] }),
      );
    }
    return [
      new Table({
        width: { size: W, type: WidthType.DXA },
        columnWidths: [photoW, panelW],
        borders: NO_BORDERS,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: photoW, type: WidthType.DXA },
                margins: { top: 0, bottom: 0, left: 0, right: 100 },
                children: [new Paragraph({ children: [cardImage(c, 330)] })],
              }),
              new TableCell({
                width: { size: panelW, type: WidthType.DXA },
                shading: { type: ShadingType.CLEAR, fill: "F8FAFC" },
                margins: { top: 140, bottom: 140, left: 160, right: 160 },
                children: [
                  new Paragraph({ children: [t(c.name, { size: 22, bold: true, color: NAVY })] }),
                  ...(c.tagline
                    ? [
                        new Paragraph({
                          spacing: { after: 120 },
                          children: [t(c.tagline, { size: 15, italics: true, color: GRAY })],
                        }),
                      ]
                    : [new Paragraph({ spacing: { after: 80 }, children: [] })]),
                  ...(specRows.length
                    ? [
                        new Table({
                          width: { size: panelW - 320, type: WidthType.DXA },
                          columnWidths: [Math.floor((panelW - 320) / 2), Math.floor((panelW - 320) / 2)],
                          borders: NO_BORDERS,
                          rows: specRows,
                        }),
                      ]
                    : []),
                  new Paragraph({
                    spacing: { before: 140 },
                    border: { top: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" } },
                    children: [t("UNDERWRITTEN IN THIS PROGRAM", { size: 12, bold: true, color: GRAY })],
                  }),
                  new Paragraph({
                    spacing: { before: 40 },
                    children: [t(underwritingOf(c), { size: 17 })],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
  }

  // Layout B — grade compacta, 2 por linha, spec + underwriting sob a foto
  const colW = Math.floor(W / 2);
  const cell = (c: ModelCard | null) =>
    new TableCell({
      width: { size: colW, type: WidthType.DXA },
      margins: { top: 100, bottom: 100, left: 100, right: 100 },
      children: c
        ? [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [cardImage(c, 285)] }),
            new Paragraph({
              spacing: { before: 60 },
              children: [t(c.name, { size: 17, bold: true, color: NAVY })],
            }),
            new Paragraph({ children: [t(specLineOf(c), { size: 14, color: "475569" })] }),
            new Paragraph({
              spacing: { before: 30 },
              children: [t(underwritingOf(c), { size: 13, color: GRAY, italics: true })],
            }),
          ]
        : [new Paragraph({ children: [] })],
    });
  const rows: TableRow[] = [];
  for (let i = 0; i < cards.length; i += 2) {
    rows.push(new TableRow({ children: [cell(cards[i]), cell(cards[i + 1] ?? null)] }));
  }
  return [
    new Table({
      width: { size: W, type: WidthType.DXA },
      columnWidths: [colW, colW],
      borders: NO_BORDERS,
      rows,
    }),
  ];
}

// Selo "Capital Sized Using the Stress-Tested Scenario" — faixa fina azul-clara
const sealBand = (text: string) =>
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [W],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: W, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: "EFF6FF" },
            margins: { top: 90, bottom: 90, left: 160, right: 160 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [t(text, { size: 19, bold: true, color: NAVY })],
              }),
            ],
          }),
        ],
      }),
    ],
  });

// Box de destaque com filete navy à esquerda (pergunta + resposta) — usado no §6
function calloutBox(title: string, text: string) {
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [W],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: W, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: "F8FAFC" },
            borders: { left: { style: BorderStyle.SINGLE, size: 24, color: NAVY } },
            margins: { top: 140, bottom: 140, left: 200, right: 160 },
            children: [
              new Paragraph({
                spacing: { after: 80 },
                children: [t(title, { size: 20, bold: true, color: NAVY })],
              }),
              new Paragraph({
                alignment: AlignmentType.JUSTIFIED,
                spacing: { line: 276 },
                children: [t(text, { size: 20 })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

// Nomes dos cenários no DB são em português — o documento é em inglês.
// Narrativa aprovada 15/07: Expected é o caso-base declarado (benchmarked no §3), Stress
// dimensiona a captação, Upside é mercado forte + execução. Motor e app continuam OPT/REAL/CONS.
const SCENARIO_EN: Record<string, string> = {
  OPT: "Upside Case",
  REAL: "Expected Case",
  CONS: "Stress Case",
};

const aiNote = (d: ReportData, prose: ReportProse) =>
  new Paragraph({
    spacing: { after: 200, line: 264 },
    children: [
      new TextRun({
        text: `Commentary generated by the Manager's analysis platform from the ATTOM MLS extract of ${d.market.extractDate} and the figures of this Summary (model: ${prose.model}, ${prose.generatedAt}); every statement is limited to the data shown herein.`,
        font: FONT,
        size: 16,
        color: GRAY,
        italics: true,
      }),
    ],
  });

export function buildReportDocx(d: ReportData, recipient?: string, prose?: ReportProse | null): Document {
  const isClient = d.vehicleStructure === "CLIENT_ENTITY";
  const entityName = d.clientEntityName || "the investor group's own entity";
  // waterfall da Vixus por extenso: "up to 8% p.a. — 0%; 8–15% — 20%; above 15% — 35%"
  const tiersText = (() => {
    const ts = d.promoteTiers ?? [];
    if (!ts.length) return "";
    let prev: number | null = null;
    const parts = ts.map((t0) => {
      const range =
        t0.hurdlePct == null
          ? `above ${prev ?? 0}% p.a.`
          : prev == null
            ? `up to ${t0.hurdlePct}% p.a.`
            : `${prev}–${t0.hurdlePct}% p.a.`;
      if (t0.hurdlePct != null) prev = t0.hurdlePct;
      return `${range} — ${t0.promotePct}%`;
    });
    return parts.join("; ");
  })();
  const scenarioName = (s: { code: string; name: string }) => SCENARIO_EN[s.code] ?? s.name;
  // Expected (REAL) = base operacional; Stress (CONS) dimensiona a captação; Upside (OPT)
  const expected = d.scenarios.find((s) => s.code === d.baseCode) ?? d.scenarios[0];
  const stress = d.scenarios.find((s) => s.code === "CONS") ?? expected;
  const upside = d.scenarios.find((s) => s.code === "OPT") ?? expected;
  // ordem de leitura da tabela: Expected → Stress → Upside, e qualquer cenário extra depois
  const ordered = [
    expected,
    ...(stress !== expected ? [stress] : []),
    ...(upside !== expected && upside !== stress ? [upside] : []),
  ];
  for (const s of d.scenarios) if (!ordered.includes(s)) ordered.push(s);
  const stressSized = stress.peakCapital > expected.peakCapital + 0.5;
  const isBank = d.fundingMode === "BANK";
  const nHomes = d.base.units.length;
  const cyclesText =
    d.cycles.length > 1
      ? d.cycles.map((c) => `Cycle ${c.cycle} — ${c.homes} home${c.homes > 1 ? "s" : ""}`).join("; ")
      : "single construction cycle";
  const savingPct =
    d.singleShotPeak && d.singleShotPeak > 0
      ? Math.round((1 - expected.peakCapital / d.singleShotPeak) * 100)
      : null;

  // Logos com a mesma altura visual (px a 96dpi), centralizadas lado a lado
  const logoH = 52;
  const logo4uW = Math.round((LOGO_4U.width / LOGO_4U.height) * logoH); // horizontal: 4U + HOMES
  const vixusH = 78; // marca da Vixus é mais "quadrada" — um pouco maior p/ equilibrar
  const logoVixusW = Math.round((LOGO_VIXUS.width / LOGO_VIXUS.height) * vixusH);

  const navyBandCell = (inner: Paragraph[]) =>
    new Table({
      width: { size: W, type: WidthType.DXA },
      columnWidths: [W],
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: W, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, fill: NAVY },
              margins: { top: 420, bottom: 420, left: 400, right: 400 },
              children: inner,
            }),
          ],
        }),
      ],
    });

  const children: (Paragraph | Table)[] = [
    // ── COVER ──
    new Paragraph({ spacing: { before: 900 }, children: [] }),
    // logos lado a lado, centralizadas
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          type: "png",
          data: Buffer.from(LOGO_4U.data, "base64"),
          transformation: { width: logo4uW, height: logoH },
        }),
        new TextRun({ text: "      ", font: FONT, size: 40 }),
        new ImageRun({
          type: "png",
          data: Buffer.from(LOGO_VIXUS.data, "base64"),
          transformation: { width: logoVixusW, height: vixusH },
        }),
      ],
    }),
    new Paragraph({ spacing: { before: 1500 }, children: [] }),
    // faixa navy com o título — cara de capa de fundo
    navyBandCell([
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [new TextRun({ text: "INVESTMENT SUMMARY", font: FONT, size: 60, bold: true, color: "FFFFFF" })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: d.simName, font: FONT, size: 30, bold: true, color: "D9E2F0" })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: "Residential Build-to-Sell Program — Central & Southwest Florida",
            font: FONT,
            size: 22,
            color: "9FB3CF",
          }),
        ],
      }),
    ]),
    new Paragraph({ spacing: { before: 600 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "4U Custom Homes — Builder    ·    Vixus Investment — Manager", font: FONT, size: 22, color: GRAY }),
      ],
    }),
    new Paragraph({ spacing: { before: 2400 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: NAVY } },
      spacing: { before: 200 },
      children: [],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160 },
      children: [new TextRun({ text: "CONFIDENTIAL — FOR DISCUSSION PURPOSES ONLY", font: FONT, size: 20, bold: true, color: "991B1B" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80 },
      children: [t(`${d.generatedAt}${recipient ? `  ·  Prepared for ${recipient}` : ""}`, { color: GRAY })],
    }),
    new Paragraph({ children: [new PageBreak()] }),

    // ── IMPORTANT NOTICES ──
    h1("Important Notices"),
    body(
      "This Investment Summary (the “Summary”) is furnished on a confidential basis to a limited number of sophisticated prospective investors for the sole purpose of evaluating a potential investment in the project described herein (the “Project”). It is not an offer to sell, or a solicitation of an offer to buy, any security. Any such offer will be made only through definitive offering documents (including a private placement memorandum, operating agreement and subscription agreement), which will contain material information not included herein and will supersede this Summary in its entirety.",
    ),
    ...(isClient
      ? [
          body(
            `This Summary is prepared for ${entityName}, an entity owned and controlled by the investor group, in connection with Vixus Investment's engagement as Development Manager and 4U Custom Homes' engagement as builder. Nothing herein constitutes an offer or sale of securities by Vixus Investment or 4U Custom Homes; the formation, governance and taxation of the investor entity — and any offering of interests within it — are matters for that entity and its own legal and tax advisors. An investment in the program involves a high degree of risk, including the possible loss of the entire investment.`,
          ),
        ]
      : [
          body(
            "Securities, if and when offered, are expected to be offered in reliance on the exemption provided by Rule 506(b) of Regulation D under the Securities Act of 1933, as amended, and applicable Florida law, to investors with whom the sponsor has a pre-existing substantive relationship. Securities have not been and will not be registered with the U.S. Securities and Exchange Commission or any state securities authority, are subject to restrictions on transferability and resale, and involve a high degree of risk, including the possible loss of the entire investment.",
          ),
        ]),
    body(
      "This Summary contains forward-looking statements, projections and scenario analyses that are based on assumptions believed to be reasonable as of the date hereof. The “Expected Case” presented herein is the Manager's base operating case — the outcome the Manager considers most likely — and not a guarantee or a promise of performance; the “Stress Case” is a deliberately adverse scenario used to size the offering. Projected and expected returns are hypothetical, are not guarantees of future performance, and actual results will differ — possibly materially. Unless expressly stated otherwise, all projected returns are presented net of builder compensation and project-level fees described herein, and before any taxes payable by investors. Recipients should conduct their own due diligence and consult their own legal, tax and financial advisors.",
    ),
    new Paragraph({ children: [new PageBreak()] }),

    // ── INVESTMENT HIGHLIGHTS (aprovado 15/07) — o investidor decide em segundos se
    // continua lendo; TODOS os bullets são condicionais às variáveis da simulação ──
    h1("Investment Highlights"),
    body([t(`Why invest in ${d.simName}?`, { bold: true, size: 24, color: NAVY })], {
      alignment: AlignmentType.LEFT,
      spacing: { after: 220 },
    }),
    // Ordem psicológica (feedback 15/07): primeiro compra-se a EMPRESA, depois a estrutura
    bullet([
      t("Proven sponsor — ", { bold: true }),
      t("450+ homes delivered and $100M+ in accumulated sales volume since 2019, across six Florida regions (Section 2)."),
    ]),
    bullet([
      t("Capital sized for the Stress Case — ", { bold: true }),
      t("investors fund the program through its stressed scenario, not its expected outcome."),
    ]),
    ...(d.compMode === "OPEN_BOOK"
      ? [
          bullet([
            t("Open-book construction — ", { bold: true }),
            t("the Builder's margin is fixed and fully disclosed per home; every cost is auditable against invoices."),
          ]),
        ]
      : d.compMode === "PERFORMANCE" || d.compMode === "PROMOTE"
        ? [
            bullet([
              t("Builder paid on performance — ", { bold: true }),
              t("builder compensation is subordinated to realized project profit; no fee is payable regardless of outcome."),
            ]),
          ]
        : [
            bullet([
              t("Fixed-price construction contract — ", { bold: true }),
              t("construction cost risk within the contract is borne by the Builder, not the investors."),
            ]),
          ]),
    ...(isBank
      ? [
          bullet([
            t("Disciplined construction leverage — ", { bold: true }),
            t(
              "interest accrues on drawn balances only, and the facility is modeled line-by-line from executed term sheets (Section 5).",
            ),
          ]),
        ]
      : [
          bullet([
            t("All-equity program — ", { bold: true }),
            t("no construction debt: no lender fees, no interest-rate exposure, no maturity risk."),
          ]),
        ]),
    ...(d.hasPromote
      ? [
          bullet([
            t("Preferred-return waterfall — ", { bold: true }),
            t("the Development Manager is compensated only above investor return hurdles; investors are paid first."),
          ]),
        ]
      : []),
    ...(isClient
      ? [
          bullet([
            t("Investor-owned entity — ", { bold: true }),
            t("the group holds the money and controls its own vehicle; Vixus runs the program as Development Manager."),
          ]),
        ]
      : [
          bullet([
            t("Dedicated LLC for this program — ", { bold: true }),
            t("one vehicle per program, never reused; fixed $1,000 units with no later-stage dilution."),
          ]),
        ]),
    bullet([
      t("Proprietary technology platform — ", { bold: true }),
      t("every capital call, construction draw and distribution is tracked on the sponsor's own platform; this Summary is generated from it (Section 2)."),
    ]),
    bullet([
      t("Underwriting benchmarked against closed transactions — ", { bold: true }),
      t("assumptions are positioned against sold MLS comparables from a weekly ATTOM data feed (Section 3), not asking prices."),
    ]),
    bullet([
      t("Monthly investor reporting — ", { bold: true }),
      t("statements are generated directly from the operating ledger, not from separately prepared spreadsheets."),
    ]),
    ...(d.cycles.length > 1
      ? [
          bullet([
            t(`Capital recycling across ${d.cycles.length} chained cycles — `, { bold: true }),
            t("the same equity base produces multiple homes, which is what drives the projected IRR (Section 4)."),
          ]),
        ]
      : []),
    new Paragraph({ children: [new PageBreak()] }),

    // ── 1. EXECUTIVE SUMMARY ──
    h1("1. Executive Summary"),
    body(
      "The Project is a residential build-to-sell program executed by 4U Custom Homes (the “Builder”) and administered by Vixus Investment (the “Manager”) in high-absorption submarkets of Central and Southwest Florida. " +
        (d.cycles.length > 1
          ? "Investor capital funds land acquisition and vertical construction of single-family homes that are sold upon completion; capital is recycled through consecutive, pre-permitted construction cycles (the “Pipeline”), so that the same equity base produces multiple homes over the life of the program."
          : "Investor capital funds land acquisition and vertical construction of single-family homes in a single construction wave with staggered starts; capital is returned as each home sells and closes."),
    ),
    // Bloco de retorno (substitui a linha "Projected net IRR (base case)" que liderava
    // com o número do stress): Expected primeiro, em navy — lê-se da esquerda p/ direita
    kpiStrip([
      {
        label: "Expected Investor IRR (net)",
        value: pct(expected.irrAnnual),
        sub: "base operating case · most likely outcome",
        main: true,
      },
      {
        label: "Stress-Tested Downside",
        value: pct(stress.irrAnnual),
        sub: `price discounts, cost overruns, extended timelines${stress.profit >= 0 ? " — capital preserved" : ""}`,
      },
      {
        label: "Upside Potential",
        value: pct(upside.irrAnnual),
        sub: "strong market conditions & execution",
      },
    ]),
    ...(stressSized ? [sealBand("🛡  CAPITAL SIZED USING THE STRESS-TESTED SCENARIO")] : []),
    new Paragraph({
      spacing: { before: 100, after: 220, line: 252 },
      children: [
        new TextRun({
          text:
            "Expected Case assumptions are benchmarked against closed market transactions (Section 3) and the Builder's " +
            (d.trackRecord.sample.n > 0
              ? "realized performance on closed projects (Section 2)"
              : "delivery history of 450+ homes (Section 2)") +
            ". Expected returns are not guaranteed." +
            (stressSized
              ? " The raise is sized to the Stress Case — investors fund the program through its stressed scenario, not its expected outcome."
              : ""),
          font: FONT,
          size: 16,
          color: GRAY,
          italics: true,
        }),
      ],
    }),
    h2("Investment at a Glance"),
    kvTable([
      [
        "Program",
        `${nHomes} home${nHomes > 1 ? "s" : ""} in ${d.cycles.length > 1 ? `${d.cycles.length} chained cycles` : "a single cycle"} across ${d.locations.join(", ")}`,
      ],
      [
        "Vehicle",
        isClient
          ? `${entityName} — owned and controlled by the investor group (structure selected by the group for its own legal and tax profile); Vixus Investment engaged as Development Manager`
          : "Dedicated Florida limited liability company (to be formed for this program); single class of non-voting investor units of $1,000 each",
      ],
      ["Projected duration (Expected Case)", `${months(expected.durationDays)} months`],
      ["Peak invested capital (Expected Case)", money0(expected.peakCapital)],
      [
        "Target raise",
        stressSized
          ? `${money0(stress.peakCapital)} — sized using the Stress Case (Section 6)`
          : `${money0(expected.peakCapital)} (Expected Case peak capital)`,
      ],
      [
        "Projected equity multiple (Expected Case)",
        expected.equityMultiple == null ? "—" : `${expected.equityMultiple.toFixed(2)}x`,
      ],
      ["Builder compensation", d.compLabel],
      ...(d.hasPromote
        ? [
            [
              "Developer compensation",
              `Vixus Investment (Development Manager) — waterfall payable at completion, only above investor return hurdles: ${tiersText}`,
            ] as [string, string],
          ]
        : []),
      [
        "Construction financing",
        isBank
          ? `${d.bankName ?? "Construction facility"} — interest on drawn balance only${d.bankTerms ? `; up to ${d.bankTerms.ltcBuildPct}% LTC / ${d.bankTerms.ltvPct}% LTV, ${d.bankTerms.aprEffectivePct.toFixed(2)}% APR, ${d.bankTerms.termMonths}-month term` : ""}`
          : "All-equity program — no construction debt",
      ],
      ["Distributions", "Return of capital as sales close, under the cash-first rule; profit distributed at program completion"],
      ["Reporting", "Investor portal with monthly statements, per-home budget vs. actual, and bank reconciliation"],
    ]),
    body(""),
    body([
      t("The financial model underlying this Summary is maintained on the Manager’s proprietary platform and has been "),
      t("validated against the actual bank statement of a completed construction facility", { bold: true }),
      t(
        " — fees reproduced to the cent and interest accruals within a fraction of one percent — and every projection in this document closes to the cent: sources and uses reconcile exactly to projected investor profit (Appendix A.4).",
      ),
    ]),

    // ── 2. SPONSOR ──
    h1("2. Sponsor & Track Record"),
    // Números grandes primeiro (feedback 15/07) — o investidor compra a empresa antes da casa
    bigStatGrid([
      { value: "450+", label: "Homes delivered" },
      { value: "$100M+", label: "Sales volume" },
      { value: "6", label: "Florida markets" },
      { value: "2019", label: "Operating since" },
    ]),
    body(""),
    h2("4U Custom Homes — the Builder"),
    bullet([
      t("Founded in 2019; headquartered in Orlando, Florida. Over "),
      t("450 homes delivered", { bold: true }),
      t(" and more than "),
      t("$100 million in accumulated sales volume", { bold: true }),
      t("."),
    ]),
    bullet("Active in six strategic regions: Marion Oaks (Ocala), Citrus Springs, North Port, Port Charlotte, Poinciana and Rotonda West."),
    bullet([
      t("Standardized product line (Arpoador, Copacabana, Leblon, Maragogi, Ubatuba, among others) with an average "),
      t("five-month construction cycle", { bold: true }),
      t(" from permit to certificate of occupancy."),
    ]),
    bullet(
      "Vertically integrated through Truss Direct, the group’s truss manufacturer supplying 90+ projects per month — insulating the program from a key supply-chain bottleneck.",
    ),
    bullet("BBB accredited; every home delivered with a 2-10 structural warranty and covered by builder’s risk insurance during construction."),
    // Execution at scale (mock aprovado 15/07): n grande de DATAS da planilha TrackRecord
    // — cria a escada 450+ → 304 → 44 e prova a máquina; financials dela são internos
    ...(d.trackRecord.execution && d.trackRecord.execution.trackedProjects > 0
      ? [
          h2("Execution at scale"),
          body([
            t(
              "Every project is tracked milestone-by-milestone — permit, foundation, certificate of occupancy, closing — in the Builder's operating system. Across the ",
            ),
            t(
              `${d.trackRecord.execution.trackedProjects} projects tracked in the current extraction (${d.trackRecord.execution.periodYears})`,
              { bold: true },
            ),
            t(":"),
          ]),
          bigStatGrid([
            {
              value: `${(d.trackRecord.execution.buildMedianDays / 30).toFixed(1)} mo`,
              label: `Median build time · n=${d.trackRecord.execution.buildN}`,
            },
            {
              value: `${(d.trackRecord.execution.permitToCoMedianDays / 30).toFixed(1)} mo`,
              label: `Median permit → CO · n=${d.trackRecord.execution.permitToCoN}`,
            },
            {
              value: `≈${Math.round(d.trackRecord.execution.ramp.toCount / Math.max(1, d.trackRecord.execution.ramp.fromCount))}×`,
              label: `Delivery ramp · ${d.trackRecord.execution.ramp.fromCount} COs ${d.trackRecord.execution.ramp.fromYear} → ${d.trackRecord.execution.ramp.toCount} in ${d.trackRecord.execution.ramp.toYear}`,
            },
            {
              value: String(d.trackRecord.execution.inProductionNow),
              label: "Homes in production today",
            },
          ]),
          body(""),
        ]
      : []),
    // Retornos verificados — NARRATIVA DE AMOSTRAGEM (regra do Stefan 15/07: o registro é
    // COMPLETO; a amostra é extraída dele, e a janela recente é escolha técnica — nunca
    // escrever que os projetos antigos não têm controle). TIR sempre "estimated".
    ...(d.trackRecord.sample.n > 0
      ? [
          h2("Verified investor returns — representative sample"),
          body([
            t("Returns are measured on a "),
            t(`representative sample of ${d.trackRecord.sample.n} recent closed projects`, { bold: true }),
            t(
              `, drawn from the Builder's complete project records: every client project closed in ${d.trackRecord.sample.periodYears} with full milestone and financial detail in the current data extraction. The recent window is the decision-relevant sample — it reflects today's construction costs, pricing and cycle times, the same environment this program is underwritten in. On these projects, the realized net return on total project cost — lot plus construction — was a median of `,
            ),
            t(`${d.trackRecord.roiPerCyclePct.median}% per cycle`, { bold: true }),
            t(
              ` (range ${d.trackRecord.roiPerCyclePct.min}%–${d.trackRecord.roiPerCyclePct.max}%), over a median cycle of ${(d.trackRecord.cycle.medianDays / 30).toFixed(1)} months from contract to sale closing.`,
            ),
          ]),
          bigStatGrid([
            { value: `${d.trackRecord.roiPerCyclePct.median}%`, label: "Realized ROI / cycle (median)" },
            { value: `${d.trackRecord.estimatedIrrPct.median}%`, label: "Estimated investor IRR (median)" },
            { value: `${d.trackRecord.conservativeFloorIrrPct.median}%`, label: "Conservative-floor IRR (median)" },
            { value: `${(d.trackRecord.cycle.medianDays / 30).toFixed(1)} mo`, label: "Median cycle" },
          ]),
          new Paragraph({
            spacing: { before: 100, after: 200, line: 252 },
            children: [
              new TextRun({
                text:
                  `Estimated IRR applies the program's actual client payment schedule (${d.trackRecord.paymentPlanPct.join("/")}) to each project's real permit, foundation, completion and closing dates; the conservative floor assumes all capital deployed on day one — under that floor, no project in the sample returned less than ${d.trackRecord.conservativeFloorIrrPct.min}% annualized. These are estimates derived from realized profits and actual dates, not realized IRRs, and prior performance is not indicative of future results.`,
                font: FONT,
                size: 16,
                color: GRAY,
                italics: true,
              }),
            ],
          }),
        ]
      : []),
    // Ficha dos modelos da cesta (só quando há foto cadastrada no catálogo)
    ...(d.modelCards.length > 0
      ? [
          h2("The homes in this program"),
          ...modelCardsBlock(d.modelCards),
          new Paragraph({
            spacing: { before: 60, after: 160 },
            children: [
              new TextRun({
                text: "Model specifications as published by the Builder (4youhomes.com/portfolio); underwriting figures from this program's Expected Case. Per-home economics for each home are detailed in Appendix A.1.",
                font: FONT,
                size: 16,
                color: GRAY,
                italics: true,
              }),
            ],
          }),
        ]
      : []),
    h2(isClient ? "Vixus Investment — the Development Manager" : "Vixus Investment — the Manager"),
    body(
      isClient
        ? "Vixus Investment acts as Development Manager to investor-owned entities: it runs the program — land acquisition within the disclosed basket, construction disbursements against milestones, sales coordination and reporting — under a development management agreement, without custody of the investor entity. The same purpose-built platform tracks every dollar, and the entity's members receive statements generated from the same ledger Vixus uses to run the program."
        : "Vixus Investment administers investor vehicles for the group: capitalization, capital calls, construction-loan reconciliation, tax (K-1) coordination and investor reporting. The Manager operates a purpose-built platform that tracks every dollar from subscription to distribution; investors receive statements generated from the same ledger the Manager uses to run the business.",
    ),
    // Diferencial que quase nenhum sponsor pequeno tem — o software (feedback 15/07)
    h2("Technology-driven investment management"),
    body([
      t(
        "Every capital call, construction draw, budget variance and distribution is tracked in the same proprietary platform used to operate the business — investors receive reports generated directly from the operating ledger, not from manually prepared spreadsheets. ",
      ),
      t("This Summary itself is an output of that platform: ", { bold: true }),
      t(
        "each edition is generated from a live simulation, refreshed against the weekly MLS extract, and blocked from issuance unless its sources and uses reconcile to the cent (Appendix A.4). A traditional sponsor updates a spreadsheet; this program's numbers cannot drift from its books.",
      ),
    ]),
    h2("Leadership"),
    // Formato executivo (feedback 15/07): nome/cargo + "Responsible for" — currículo vira função
    new Table({
      width: { size: W, type: WidthType.DXA },
      columnWidths: [3120, 3120, 3120],
      rows: [
        new TableRow({
          children: [
            {
              name: "Stefan Braga Lemos",
              title: "Founder & COO",
              areas: ["Operations", "Construction", "Cost control", "Investment platform"],
              bg: "Civil engineer; co-owned Avantec Engenharia (Brazil) before founding 4U in 2019.",
            },
            {
              name: "Evair Gallardo",
              title: "CEO",
              areas: ["Strategy", "Corporate development", "Supply chain (Truss Direct)"],
              bg: "Founder and director experience in Brazilian telecom (Kerax); CEO of Truss Direct.",
            },
            {
              name: "Patrick Geaquinto",
              title: "Founder & VP of Sales",
              areas: ["Sales & pricing", "Broker network", "Market coverage"],
              bg: "Commercial Director at Avantec Engenharia; previously Orla Construções. Co-founded 4U in 2019.",
            },
          ].map(
            (p) =>
              new TableCell({
                width: { size: 3120, type: WidthType.DXA },
                shading: { type: ShadingType.CLEAR, fill: "F8FAFC" },
                margins: { top: 160, bottom: 160, left: 160, right: 160 },
                children: [
                  new Paragraph({ children: [t(p.name, { size: 21, bold: true, color: NAVY })] }),
                  new Paragraph({
                    spacing: { after: 100 },
                    children: [t(p.title.toUpperCase(), { size: 15, bold: true, color: GRAY })],
                  }),
                  new Paragraph({
                    spacing: { after: 40 },
                    children: [t("Responsible for:", { size: 16, italics: true, color: GRAY })],
                  }),
                  ...p.areas.map(
                    (a) =>
                      new Paragraph({
                        spacing: { after: 20 },
                        children: [t("✔  ", { size: 17, color: "16A34A" }), t(a, { size: 18 })],
                      }),
                  ),
                  new Paragraph({
                    spacing: { before: 100 },
                    children: [t(p.bg, { size: 15, italics: true, color: GRAY })],
                  }),
                ],
              }),
          ),
        }),
      ],
    }),
    body(""),
    // Alinhamento de interesses — DINÂMICO por modo de remuneração (feedback do advogado
    // 14/07: a prosa fixa de "performance" contradizia o open book das págs. 3 e 7)
    ...(d.compMode === "PERFORMANCE" || d.compMode === "PROMOTE"
      ? [
          body([
            t("Alignment of interests: the Builder’s compensation is "),
            t("subordinated to project performance", { bold: true }),
            t(
              " — under this model, 4U earns only a share of realized net profit. There is no development fee payable regardless of outcome.",
            ),
          ]),
        ]
      : d.compMode === "OPEN_BOOK"
        ? [
            body([
              t("Alignment of interests: construction is delivered on an "),
              t("open-book basis", { bold: true }),
              t(
                ` — the Builder bills documented construction cost plus a fixed, fully disclosed fee of ${money0(d.flatFeePerHouse)} per home. The Builder’s margin is transparent and capped per home, every cost is auditable against invoices on the Manager’s platform` +
                  (d.hasPromote
                    ? ", and any additional performance share accrues only above investor return hurdles (see Section 7)."
                    : ", and cost overruns compress the Builder’s effective economics — not the investor’s protections."),
              ),
            ]),
          ]
        : [
            body([
              t("Alignment of interests: the Builder works under a "),
              t("fixed contractor fee", { bold: true }),
              t(
                " embedded in the construction contract — the Builder’s compensation is capped per home and fully reflected in the per-home economics of Appendix A; construction cost risk within the contract is borne by the Builder, not the investors.",
              ),
            ]),
          ]),

    // ── 3. MARKET ──
    h1("3. Market Opportunity"),
    body([
      t(
        `The program builds entry-level and mid-range single-family homes in Florida submarkets selected for permit velocity, lot availability and sustained absorption. Statistics are derived from a weekly ATTOM MLS feed (extract of ${d.market.extractDate}; ${d.market.totalListings.toLocaleString("en-US")} listings across ${d.market.counties.join(", ")} counties; sold figures reflect the trailing ${d.market.windowDays} days) and refresh with every edition of this Summary.`,
      ),
    ]),
    gridTable(
      ["Submarket", "Median sale $/SF", "New-constr. $/SF", "Median DOM", `Sold (${d.market.windowDays}d)`, "New-constr. share"],
      d.market.submarkets.map((s) => [
        s.name,
        s.medianPricePerSf == null ? "—" : `$${s.medianPricePerSf.toFixed(0)}`,
        s.medianPricePerSfNewConstruction == null ? "—" : `$${s.medianPricePerSfNewConstruction.toFixed(0)}`,
        s.medianDaysOnMarket == null ? "—" : String(s.medianDaysOnMarket),
        String(s.soldCount90d),
        s.newConstructionSharePct == null ? "—" : `${s.newConstructionSharePct}%`,
      ]),
      [2360, 1540, 1540, 1240, 1240, 1440],
    ),
    body(""),
    // Benchmark de premissas × vendidos (aprovado 14/07) — a ponte entre mercado e projeções.
    // §3 enxugado 15/07: a frase de pricing foi fundida aqui (era um parágrafo próprio)
    ...(d.benchmark.some((b) => b.verdict !== "NO_DATA")
      ? [
          h2("Underwriting vs. observed market"),
          body(
            "Each underwriting assumption below is positioned against closed transactions in its submarket: lot costs against sold lots, sale prices against sold new-construction homes ($/SF where floor-plan areas are on file). The Expected Case prices relative to these observed medians; the Stress Case applies an additional discount on top.",
          ),
          gridTable(
            ["Assumption", "Program", "Market median (sold)", "Percentile"],
            d.benchmark
              .filter((b) => b.verdict !== "NO_DATA")
              .map((b) => [
                `${b.kind === "lot" ? "Lot cost" : "Sale price"} — ${b.label.replace("@", "·")}`,
                b.unit === "$/sf" ? `$${b.ours.toFixed(0)}/SF` : money0(b.ours),
                b.marketMedian == null
                  ? "—"
                  : `${b.unit === "$/sf" ? `$${b.marketMedian.toFixed(0)}/SF` : money0(b.marketMedian)}  (n=${b.n})`,
                b.percentile == null ? "—" : `P${b.percentile}`,
              ]),
            [3960, 1800, 2400, 1200],
          ),
          body(""),
        ]
      : [
          body(
            "Program pricing is underwritten against these observed comparables: the Expected Case prices relative to the prevailing new-construction medians in each submarket, and the Stress Case applies an additional discount on top.",
          ),
        ]),
    ...(prose?.marketCommentary?.length
      ? [
          h2("Market commentary"),
          ...prose.marketCommentary.map((p) => body(p)),
          aiNote(d, prose),
        ]
      : []),

    // ── 4. STRATEGY — prosa acompanha a estrutura REAL (feedback do advogado 14/07:
    // descrever a esteira num projeto de ciclo único contradizia o §6) ──
    h1(d.cycles.length > 1 ? "4. Investment Strategy — the Pipeline" : "4. Investment Strategy"),
    ...(d.cycles.length > 1
      ? [
          body(
            "The program’s core mechanic is disciplined capital recycling. Homes are organized in chained cycles: while the first basket of homes is under construction, lots for the following cycle are acquired and permit applications are filed in advance, so that each closed sale immediately triggers the start of the next home (“sell one, start one”). The initial raise is sized to fund the first cycle in full plus the land and permit-application costs of the second; from the third cycle onward, expansion is funded primarily by recycled sale proceeds.",
          ),
          bullet(
            "Permit discipline: permit costs are always funded by equity — construction lenders do not fund permits. Pre-permitting is what allows a new home to break ground the day after its triggering sale closes.",
          ),
          ...(savingPct != null && savingPct > 0
            ? [
                bullet([
                  t("Capital efficiency: the Pipeline delivers the program’s "),
                  t(`${nHomes} homes`, { bold: true }),
                  t(" with approximately "),
                  t(`${savingPct}% less peak capital`, { bold: true }),
                  t(
                    ` than building all homes simultaneously (${money0(expected.peakCapital)} vs. ${money0(d.singleShotPeak!)}) — the same aggregate profit on materially less equity at risk, which is what drives the projected IRR.`,
                  ),
                ]),
              ]
            : []),
          bullet(
            "Just-in-time treasury: investor capital is called only when project cash cannot cover the next obligation, and surplus cash is returned as soon as the forward schedule no longer requires it.",
          ),
          bullet([t("Cycle structure for this Project: "), t(cyclesText, { bold: true }), t(".")]),
        ]
      : [
          body(
            `The program builds its ${nHomes} homes in a single construction wave with staggered starts, so that lot acquisition, permitting and construction advance as a coordinated schedule rather than all at once. Homes are sold individually upon completion, and investor capital is returned as each sale closes — the timeline in Section 5 shows the resulting phase windows.`,
          ),
          bullet(
            "Permit discipline: permit costs are always funded by equity — construction lenders do not fund permits. Construction begins only after the lot is owned and the permit is issued.",
          ),
          bullet(
            "Just-in-time treasury: investor capital is called only when project cash cannot cover the next obligation, and surplus cash is returned as soon as the forward schedule no longer requires it — capital is never idle by design.",
          ),
          bullet(
            "The same engine supports multi-cycle programs (“sell one, start one”), where sale proceeds trigger the next home; this Project is underwritten as a single cycle.",
          ),
        ]),

    // ── 5. FINANCING ──
    h1("5. Construction Financing Discipline"),
    ...(isBank
      ? [
          body([
            t(
              `Construction facilities are sized per home at the lesser of ${d.bankTerms?.ltcBuildPct ?? "—"}% of cost basis (construction contract plus lot) and ${d.bankTerms?.ltvPct ?? "—"}% of appraised completed value, rounded down to the nearest $5,000. Interest accrues on the drawn balance only. Lender terms — origination, broker, title, inspection and reconveyance fees, interest-reserve mechanics and release provisions — are modeled line-by-line from executed term sheets rather than approximated.`,
            ),
          ]),
          body([
            t("The Manager’s model has been benchmarked against the full bank statement of a completed facility: all fees reproduced exactly and interest accruals within a fraction of one percent of the lender’s own figures. For this Project, the modeled facility is "),
            t(`${d.bankName}`, { bold: true }),
            t(
              ` (${d.bankTerms?.aprEffectivePct.toFixed(2)}% effective APR, ${d.bankTerms?.termMonths}-month term); its full cost — ${money0(d.closing.bankCost)} across closing fees, interest and per-draw charges — is carried in every figure of Section 6.`,
            ),
          ]),
        ]
      : [
          body(
            "This program is structured all-equity: no construction debt is used, eliminating lender fees, interest-rate exposure and maturity risk. Where the Manager runs leveraged variants of a program, facilities are modeled line-by-line from executed term sheets, and the model has been benchmarked against the full bank statement of a completed facility — fees reproduced exactly and interest accruals within a fraction of one percent.",
          ),
        ]),

    // Fases do projeto + janela do loan (aprovado no mock 13/07): responde "o loan não
    // fica aberto o projeto inteiro" com números — argumento de venda p/ investidor
    h2(d.projectPhases.loan ? "Program timeline & loan exposure" : "Program timeline"),
    body(
      "Phase windows run from the first to the last home in the basket and overlap by design — capital recycling means lots are acquired and homes are sold while others are still under construction. Where the active time is shorter than the span, the phase runs in per-cycle waves: lots and permits are procured in batches, just ahead of need.",
    ),
    gridTable(
      ["Phase", "Window", "Span", "Active"],
      [
        ...(() => {
          const EN: Record<string, string> = {
            lots: "Lot acquisition",
            permits: "Permitting",
            build: "Construction",
            sales: "Sales & closings",
          };
          // Active < Span = fases em rajadas por ciclo (esteira) — honestidade do desenho
          return d.projectPhases.phases.map((p) => [
            EN[p.key] ?? p.label,
            `M${daysToMonths(p.from)} – M${daysToMonths(p.to)}`,
            `${daysToMonths(p.to - p.from).toFixed(1)} mo`,
            `${daysToMonths(p.activeDays).toFixed(1)} mo`,
          ]);
        })(),
        ...(d.projectPhases.loan
          ? [
              [
                "Construction facility outstanding",
                `M${daysToMonths(d.projectPhases.loan.from)} – M${daysToMonths(d.projectPhases.loan.to)}`,
                `${daysToMonths(d.projectPhases.loan.to - d.projectPhases.loan.from).toFixed(1)} mo`,
                `${daysToMonths(d.projectPhases.loan.activeDays).toFixed(1)} of ${daysToMonths(d.projectPhases.totalDays).toFixed(1)} mo`,
              ],
            ]
          : []),
      ],
      [3960, 2200, 1600, 1600],
      { boldLastRow: !!d.projectPhases.loan },
    ),
    body(""),
    ganttTable(d.projectPhases),
    new Paragraph({
      spacing: { before: 80, after: 200 },
      children: [
        new TextRun({
          text: "Each column is one program month; shaded blocks are the months in which the phase is actually active — white gaps within a phase reflect the per-cycle batching described above.",
          font: FONT,
          size: 16,
          color: GRAY,
          italics: true,
        }),
      ],
    }),
    ...(d.projectPhases.loan
      ? [
          body([
            t(
              `The construction facility is outstanding for ${daysToMonths(d.projectPhases.loan.activeDays).toFixed(1)} of the program's ${daysToMonths(d.projectPhases.totalDays).toFixed(1)} months — interest accrues on drawn balances only` +
                (d.projectPhases.loan.termDays != null
                  ? d.projectPhases.loan.overrunDays > 0
                    ? `; the Expected Case exceeds the facility's ${Math.round(d.projectPhases.loan.termDays / 30)}-month term by ${daysToMonths(d.projectPhases.loan.overrunDays).toFixed(1)} months, and the corresponding extension fee is carried in every figure of Section 6.`
                    : `, within the facility's ${Math.round(d.projectPhases.loan.termDays / 30)}-month term (no extension fees in the Expected Case).`
                  : "."),
            ),
          ]),
        ]
      : []),

    // ── 6. PROJECTIONS — narrativa Expected/Stress/Upside (aprovada 15/07): o Expected
    // é o caso-base declarado (defendido pelo benchmark do §3); o Stress dimensiona a
    // captação; a coluna Expected vem primeiro e em negrito ──
    h1("6. Financial Projections"),
    body([
      t("Three scenarios are presented below. The "),
      t("Expected Case", { bold: true }),
      t(
        " is the base operating case — its assumptions are benchmarked against closed transactions in Section 3 and the Builder's delivery history (Section 2). The ",
      ),
      t("Stress Case", { bold: true }),
      t(
        " exists to answer one question: what happens if sale prices fall, costs overrun and timelines extend, all at once" +
          (stressSized ? " — and it is the case used to size the raise" : "") +
          ". All figures are net of builder compensation and project-level costs, and before investor-level taxes.",
      ),
    ]),
    gridTable(
      ["Scenario", ...ordered.map((s) => scenarioName(s))],
      [
        // papel declarado de cada coluna — elimina a dúvida "qual devo acreditar?"
        [
          "Role",
          ...ordered.map((s) =>
            t(
              s === expected
                ? "most likely outcome"
                : s === stress
                  ? stressSized
                    ? "capital protection · sizes the raise"
                    : "capital protection"
                  : s === upside
                    ? "strong market & execution"
                    : "additional scenario",
              { size: 17, italics: true, color: GRAY },
            ),
          ),
        ],
        // "o Expected realmente é o cenário central" — sem %, só a hierarquia (feedback 15/07)
        [
          "Probability",
          ...ordered.map((s) =>
            t(s === expected ? "highest" : "low", { size: 17, italics: true, color: GRAY }),
          ),
        ],
        ["Projected net IRR", ...ordered.map((s, i) => t(pct(s.irrAnnual), { size: 19, bold: i === 0 }))],
        [
          "Equity multiple",
          ...ordered.map((s, i) =>
            t(s.equityMultiple == null ? "—" : `${s.equityMultiple.toFixed(2)}x`, { size: 19, bold: i === 0 }),
          ),
        ],
        // ROI sobre o PICO — o que conversa com o tamanho da captação (aprovado 14/07)
        [
          "Return on peak capital",
          ...ordered.map((s, i) =>
            t(s.peakCapital > 0 ? pct(s.profit / s.peakCapital) : "—", { size: 19, bold: i === 0 }),
          ),
        ],
        ["Peak invested capital", ...ordered.map((s, i) => t(money0(s.peakCapital), { size: 19, bold: i === 0 }))],
        ["Total investor profit", ...ordered.map((s, i) => t(money0(s.profit), { size: 19, bold: i === 0 }))],
        [
          "Program duration (months)",
          ...ordered.map((s, i) => t(String(months(s.durationDays)), { size: 19, bold: i === 0 })),
        ],
      ],
      [2760, ...ordered.map(() => Math.floor(6600 / ordered.length))],
    ),
    body(""),
    // Responde a pergunta que todo investidor fará ao comparar os dois picos
    ...(stressSized
      ? [
          calloutBox(
            "Why is the raise larger than the Expected Case capital requirement?",
            `The offering is intentionally sized using the Stress Case peak of ${money0(stress.peakCapital)} rather than the Expected Case peak of ${money0(expected.peakCapital)}. This ensures sufficient capital remains available if costs increase, timelines extend or sale prices soften — capital calls are just-in-time, so capital not required under actual conditions is simply never called or is returned earlier.`,
          ),
          body(""),
        ]
      : []),
    h2("Sources & Uses — Expected Case"),
    gridTable(
      ["Uses", "Amount", "Sources", "Amount"],
      [
        ["Land acquisition", money0(d.closing.lots), "Investor equity (peak)", money0(expected.peakCapital)],
        [
          "Vertical construction",
          money0(d.closing.construction),
          isBank ? "Construction facility (committed)" : "Recycled sale proceeds",
          isBank ? money0(d.base.kpis.bankCommitted) : money0(d.closing.sales - expected.peakCapital),
        ],
        ["Financing costs (all-in)", money0(d.closing.bankCost), isBank ? "Recycled sale proceeds" : "", isBank ? money0(d.closing.sales) : ""],
        [
          "Builder compensation",
          d.closing.builderComp > 0
            ? money0(d.closing.builderComp)
            : d.closing.contractorFeeTotal > 0
              ? `incl. in construction (${money0(d.closing.contractorFeeTotal)})`
              : "$0",
          "",
          "",
        ],
        ["Net sale proceeds (total)", money0(d.closing.sales), "", ""],
      ],
      [2810, 1870, 2810, 1870],
    ),
    body(""),
    body([
      t("Each edition of this Summary is generated from a live simulation whose sources and uses "),
      t("reconcile to the cent", { bold: true }),
      t(
        " against projected investor profit. The full calculation detail — per-home economics, the month-by-month prospective ledger, the return methodology and the reconciliation statement — is presented in Appendix A.",
      ),
    ]),
    h2("Sensitivity — Expected Case"),
    body(
      "Each variable below is shocked independently on the Expected Case — the declared base operating case — with all other assumptions held constant; the Stress Case in the table above shows the combined effect of adverse moves occurring together.",
    ),
    gridTable(
      ["Shock", "Projected net IRR", "Investor profit"],
      [
        [`— Expected Case (none)`, pct(expected.irrAnnual), money0(expected.profit)],
        ...d.sensitivity.map((s) => [s.label, pct(s.irr), money0(s.profit)]),
      ],
      [4160, 2600, 2600],
    ),
    body(""),
    body([
      t("Breakeven: ", { bold: true }),
      t(
        d.breakevenPriceDropPct == null
          ? "investor profit remains positive even under a sale-price decline of more than 60% versus the Expected Case — beyond any observed correction in the target submarkets."
          : `investor profit reaches zero at a sale-price decline of approximately ${d.breakevenPriceDropPct.toFixed(1)}% versus the Expected Case — whose sale-price assumptions are themselves positioned against closed comparables in Section 3, not asking prices.`,
      ),
    ]),

    // ── 7. STRUCTURE ──
    h1("7. Structure, Terms & Governance"),
    kvTable([
      ...(isClient
        ? ([
            ["Entity", `${entityName} — formed, owned and governed by the investor group; structure and taxation are the group's own election with its advisors.`],
            ["Development Manager", "Vixus Investment — runs the program under a development management agreement: acquisitions within the disclosed basket, milestone disbursements, sales coordination, platform reporting."],
            ["Builder", "4U Custom Homes, under the construction contract reflected in the per-home economics of Appendix A."],
            ["Builder compensation", d.compLabel],
          ] as Array<[string, string]>)
        : ([
            ["Units", "Fixed at $1,000 per unit; ownership percentages are arithmetic. The subscription window closes at land acquisition — no later-stage dilution."],
            ["Distributions", "Return of capital as home sales close; profit distributed at program completion, pro rata to units held."],
            ["Builder compensation", d.compLabel],
            ["Manager", "Vixus Investment. Investor units are non-voting; investors receive information rights and monthly reporting."],
          ] as Array<[string, string]>)),
      ...(d.hasPromote
        ? ([
            [
              "Developer compensation",
              `Vixus Investment (Development Manager) earns a waterfall only above investor return hurdles (annualized, on average capital at risk): ${tiersText}. Payable at completion — investors are paid their preferred return first.`,
            ],
          ] as Array<[string, string]>)
        : []),
      ...(!isClient && d.closing.vehicle > 0
        ? ([
            [
              "Vehicle costs",
              "Formation, annual accounting and state filings, and dissolution costs of the vehicle are modeled explicitly as dated cash flows in the projections (Appendix A) — not omitted or footnoted.",
            ],
          ] as Array<[string, string]>)
        : []),
      ...(isClient
        ? ([
            ["Offering / tax", "No securities are offered by Vixus or 4U; interests, governance and tax elections (including K-1s) are matters of the investor entity and its advisors — entity-level formation and administration costs are borne by the entity directly and are not included in the program projections."],
            ["Reporting", "Platform access for the entity and its members: program statement, per-home budget vs. actual, bank reconciliation support and distribution history."],
          ] as Array<[string, string]>)
        : ([
            ["Offering exemption", "Rule 506(b) of Regulation D; Florida §517.061(11) as applicable. Schedule K-1 issued annually. One dedicated vehicle per program — entities are never reused across programs."],
            ["Reporting", "Investor portal: monthly capital statement, per-home budget vs. actual, bank-statement reconciliation and distribution history."],
          ] as Array<[string, string]>)),
    ]),
    body(""),
    // Governança e proteções — feedback do advogado 14/07: o documento não dizia quem
    // controla a LLC, quem movimenta a conta e o que acontece quando algo derrapa
    h2("Governance & investor protections"),
    body([
      t("Control. ", { bold: true }),
      t(
        isClient
          ? "The investor group controls its own entity: its members and their chosen manager govern the vehicle, its agreements and its distributions. Vixus Investment acts strictly under the development management agreement — it runs the program, not the entity — and matters outside that agreement's scope require the entity's own approval."
          : "The company is manager-managed: Vixus Investment, as manager, conducts the ordinary course of the program — land acquisition within the disclosed basket, construction disbursements, sales and distributions. Investors hold non-voting units with full information rights. Matters outside the ordinary course, including amendments to the operating agreement and transactions with affiliates beyond the disclosed construction arrangement, are governed by the operating agreement.",
      ),
    ]),
    body([
      t("Bank account and cash controls. ", { bold: true }),
      t(
        isClient
          ? "The program's bank account belongs to the investor entity and remains under the group's own control. Vixus requests disbursements against the milestone schedule reflected in Appendix A; the Builder is never paid on demand. Every movement is recorded in the platform ledger and reconciled against the entity's bank statement, and the entity's members see the same reconciliation on the platform — the group holds the money, Vixus runs the program."
          : "The program’s bank account is held in the company’s own name and operated by the Manager. The Builder is never paid on demand: construction funds are released against the milestone disbursement schedule reflected in Appendix A, and every account movement is recorded in the platform ledger and reconciled monthly against the bank statement — investors see the same reconciliation on the portal, not a summary prepared separately for them.",
      ),
    ]),
    body([
      t("If the program slips. ", { bold: true }),
      t(
        "The underwriting funds a contingency reserve, and the raise is sized to the Stress Case of Section 6 — which assumes discounted sale prices, cost overruns and extended construction and marketing timelines occurring together. Cost overruns draw on the contingency reserve first" +
          (d.compMode === "OPEN_BOOK"
            ? "; under the open-book model the Builder’s fee is fixed per home, so overruns do not increase the Builder’s compensation."
            : d.compMode === "PERFORMANCE" || d.compMode === "PROMOTE"
              ? "; under the performance model, overruns reduce the Builder’s own share before they reach investor capital."
              : "; construction cost risk within the fixed-price contract is borne by the Builder.") +
          " Slower sales extend the timeline rather than force distressed pricing — the sensitivity table in Section 6 quantifies the effect on returns, and the breakeven analysis states how much price decline the program tolerates before investor capital is impaired." +
          (d.projectPhases.loan
            ? " Where construction debt is used, facility term overruns and extension fees are modeled explicitly (Section 5) rather than discovered later."
            : "") +
          " Monthly reporting against the per-home budget surfaces deviations early, while corrective options — repricing, re-sequencing starts, or pausing acquisitions not yet contracted — remain available.",
      ),
    ]),
    new Paragraph({
      spacing: { after: 200, line: 264 },
      children: [
        new TextRun({
          text: isClient
            ? "Definitive terms are those of the development management agreement, the construction contract and the investor entity's own governing documents, which prevail over this summary."
            : "Definitive governance, consent and transfer provisions are those of the operating agreement and subscription documents, which prevail over this summary.",
          font: FONT,
          size: 16,
          color: GRAY,
          italics: true,
        }),
      ],
    }),

    // ── 8. RISKS ──
    new Paragraph({ children: [new PageBreak()] }),
    h1("8. Risk Factors & Mitigants"),
    body(
      "An investment in the Project involves significant risk and is suitable only for investors who can bear the loss of their entire investment. The following summary is not exhaustive; the definitive offering documents will contain a complete statement of risk factors.",
    ),
    h2("Market risk"),
    body(
      "Home prices and absorption in the target submarkets may decline. Mitigants: the raise is sized to the Stress Case, which underwrites discounted sale prices and extended marketing periods; the product is positioned at entry-level price points, where the buyer pool is deepest; weekly MLS analytics are monitored for early signs of deterioration; and lender loan-to-value caps provide an independent third-party check on value.",
    ),
    h2("Construction cost and schedule risk"),
    body(
      "Costs may exceed budget and construction may take longer than projected. Mitigants: a fixed product line of repeatedly built plans with known cost history; vertical integration in truss supply; a funded contingency reserve; and the Stress Case applies buffers to both cost and duration on top of the Expected Case.",
    ),
    h2("Permitting risk"),
    body(
      "Permit issuance may be delayed. Mitigants: submarkets are selected in part for permit velocity; the Pipeline files permit applications ahead of need; and construction lenders do not close until the substantial majority of permits are issued, which independently disciplines the schedule.",
    ),
    h2("Financing risk"),
    body(
      "Construction credit may become more expensive or unavailable, and facilities carry maturity and extension provisions. Mitigants: facilities are modeled line-by-line from executed term sheets, including extension fees where a scenario exceeds the facility term; interest accrues on drawn balances only; and the program can operate on an all-equity basis at reduced scale if credit conditions deteriorate.",
    ),
    h2("Liquidity and concentration risk"),
    body(
      "Units are illiquid, transfers are restricted, and the Project is concentrated in Florida residential real estate. Capital may remain committed for the full program duration; investors should commit only capital they can leave invested for the full term.",
    ),
    h2("Sponsor and key-person risk"),
    body(
      "The Project depends on the continued involvement of the Builder’s and the Manager’s principals. Mitigants: a standardized product line and documented processes reduce dependence on any individual; builder’s risk insurance is carried during construction; delivered homes carry a 2-10 structural warranty.",
    ),
    h2("Projection risk"),
    body(
      "Projections are inherently uncertain and depend on assumptions about prices, costs, schedules and financing that may not materialize. Actual returns may be materially lower than projected, and losses — up to the entire investment — are possible.",
    ),

    // ── CLOSING REMARKS — sempre presente; a IA (quando gerada) resume os números e o
    // documento termina em filosofia, não em números (feedback 15/07) ──
    h1("9. Closing Remarks"),
    ...(prose?.closingRemarks ? [body(prose.closingRemarks), aiNote(d, prose)] : []),
    body([
      t(
        "The objective of this program is not to maximize projected returns on paper, but to preserve investor capital while delivering attractive risk-adjusted performance through disciplined execution.",
        { italics: true },
      ),
    ]),

    // ── DISCLOSURES ──
    h1("10. Additional Disclosures"),
    body(
      "No person has been authorized to make any representation not contained in this Summary, and any such representation must not be relied upon. Delivery of this Summary does not imply that the information herein is correct as of any date after the date on the cover. Prior performance of the Builder, the Manager or their affiliates — including homes delivered and sales volume — is not indicative of the Project’s future results. Certain figures herein are generated by the Manager’s simulation platform as of the date on the cover and are refreshed with each edition; the underlying assumptions are available to prospective investors upon request. This Summary is confidential and may not be reproduced or distributed, in whole or in part, without the Manager’s prior written consent.",
    ),
    // Mensagem institucional de encerramento (feedback 15/07) — a cultura que o resto
    // do documento tenta transmitir, dita uma vez, por extenso
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 420, after: 60 },
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: NAVY } },
      children: [],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 160 },
      children: [
        new TextRun({ text: "Our commitment is simple: ", font: FONT, size: 22, bold: true, color: NAVY }),
        new TextRun({
          text: "preserve investor capital first, execute with discipline, and pursue attractive risk-adjusted returns through transparency, technology, and operational excellence.",
          font: FONT,
          size: 22,
          italics: true,
          color: NAVY,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120 },
      children: [t("Contact: Vixus Investment · 8250 Exchange Dr, Suite 134, Orlando, FL 32809", { color: GRAY })],
    }),

    // ── APPENDIX A ──
    new Paragraph({ children: [new PageBreak()] }),
    h1("Appendix A — Financial Detail"),
    body(
      "This appendix opens the calculations behind the projections in Section 6. Every table is produced by the same simulation engine, on the same assumptions, for the Expected Case — the base operating case; the Stress and Upside Cases differ only by the disclosed scenario buffers. No figure is entered by hand.",
    ),
    h2("A.1  Per-home economics"),
    body(
      "Unit-level underwriting for each home in the program basket, at Expected Case values. Sale proceeds are shown net of closing costs; permit costs are embedded in the construction disbursement schedule; financing costs and performance-based builder compensation accrue at program level and appear in A.4.",
    ),
    ...(d.customAssumptions > 0
      ? [
          body([
            t(
              `Certain underwriting assumptions (${d.customAssumptions} value${d.customAssumptions > 1 ? "s" : ""} — sale prices, costs, timelines and/or scenario parameters) were adjusted by the Manager specifically for this program and differ from the Manager's standing catalog; catalog reference values are available to prospective investors upon request.`,
              { size: 18, color: GRAY, italics: true },
            ),
          ]),
        ]
      : []),
    gridTable(
      ["Home", "Lot", "Construction", "Sale (net)", "Net profit"],
      [
        ...d.base.units.map((u) => [
          u.label,
          money0(u.adjLot),
          money0(u.adjBuild),
          money0(u.adjSaleNet),
          money0(u.profit),
        ]),
        [
          "Program total",
          money0(d.closing.lots),
          money0(d.closing.construction),
          money0(d.closing.sales),
          money0(d.base.units.reduce((s, u) => s + u.profit, 0)),
        ],
      ],
      [3560, 1450, 1450, 1450, 1450],
      { boldLastRow: true },
    ),
    body(""),
    h2("A.2  Month-by-month prospective ledger"),
    body(
      "The program’s full projected cash movement by month: capital calls, land and permits, construction disbursements (including builder compensation), net bank flows (draws in, fees, interest and payoff out), sale closings and distributions — running to a cash balance that never goes below zero. This is the ledger on which the IRR is computed; the complete dated, line-item ledger is available on the Manager’s platform.",
    ),
    gridTable(
      ["Month", "Capital calls", "Land", "Construction", "Bank (net)", "Sale proceeds", "Distributions", "Ending cash"],
      d.monthly.map((m) => [
        String(m.month),
        m.calls ? money0(m.calls) : "—",
        m.land ? money0(m.land) : "—",
        m.construction ? money0(m.construction) : "—",
        m.bankNet ? money0(m.bankNet) : "—",
        m.sales ? money0(m.sales) : "—",
        m.distributions ? money0(m.distributions) : "—",
        money0(m.endingCash),
      ]),
      [760, 1290, 1140, 1290, 1190, 1290, 1290, 1110],
    ),
    body(""),
    h2("A.3  Return methodology"),
    bullet([
      t("Net IRR", { bold: true }),
      t(
        " is the annualized internal rate of return (XIRR) computed on the dated investor cash flows of the ledger in A.2 — capital calls as outflows, distributions as inflows — after builder compensation and all project-level costs, before investor-level taxes.",
      ),
    ]),
    bullet([t("Equity multiple", { bold: true }), t(" is total distributions divided by total capital called.")]),
    bullet([
      t("Peak invested capital", { bold: true }),
      t(
        " is the maximum cumulative capital outstanding at any point in the program — not the sum of all calls. The raise itself is sized on the Stress Case peak (Section 6).",
      ),
    ]),
    bullet(
      "Capital calls are just-in-time: capital is called only when projected project cash cannot cover the next obligation, so idle cash does not depress the IRR and investors are never called earlier than the schedule requires.",
    ),
    h2("A.4  Reconciliation statement"),
    body(
      "The identity below is verified by the engine for every scenario before a report can be issued; a discrepancy of even one cent blocks generation.",
    ),
    kvTable(
      [
        ["Total sale proceeds (net of closing costs)", money2(d.closing.sales)],
        ["(−) Land acquisition", money2(-d.closing.lots)],
        ["(−) Vertical construction (incl. embedded builder fees)", money2(-d.closing.construction)],
        ["(−) Financing costs (interest + all lender fees)", money2(-d.closing.bankCost)],
        ["(−) Builder compensation (performance)", money2(-d.closing.builderComp)],
        ...(d.closing.promote > 0
          ? ([["(−) Developer promote (Vixus waterfall)", money2(-d.closing.promote)]] as Array<[string, string]>)
          : []),
        ...(d.closing.vehicle > 0
          ? ([["(−) Vehicle formation & administration", money2(-d.closing.vehicle)]] as Array<[string, string]>)
          : []),
        [
          "(=) Investor profit",
          `${money2(d.closing.result)}   (equals Section 6 — difference ${money2(d.closing.diff)})`,
        ],
      ],
      4600,
    ),
  ];

  return new Document({
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 360, hanging: 200 } } },
            },
          ],
        },
      ],
    },
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: {
              top: convertInchesToTwip(0.9),
              bottom: convertInchesToTwip(0.9),
              left: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: "CONFIDENTIAL", font: FONT, size: 16, color: GRAY })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `4U Custom Homes × Vixus Investment — Investment Summary · ${d.simName} · Page `,
                    font: FONT,
                    size: 16,
                    color: GRAY,
                  }),
                  new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: GRAY }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}
