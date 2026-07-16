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
// (rascunho validado com o advogado). Números vêm do ReportData.
//
// IDIOMAS (15/07): inglês (canônico/jurídico), português-BR e espanhol latino — escolhidos
// ANTES de gerar (?lang= na rota). As traduções ficam AO LADO do inglês via tr(en, pt, es);
// PT/ES levam a ressalva "tradução livre — a versão em inglês prevalece" nos Notices até o
// advogado validar. Formatos de número/moeda ficam en-US (USD) em todos os idiomas.

export type ReportLang = "en" | "pt" | "es";
// definido no início de buildReportDocx — helpers de módulo (gantt, ficha etc.) leem daqui.
// (geração de report é uma chamada por request; corrida entre idiomas é teórica e aceitável)
let LANG: ReportLang = "en";
const tr = (en: string, pt: string, es: string) => (LANG === "pt" ? pt : LANG === "es" ? es : en);

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
  const NAMES: Record<string, string> = {
    lots: tr("Lots", "Lotes", "Lotes"),
    permits: tr("Permits", "Permits", "Permisos"),
    build: tr("Construction", "Obra", "Construcción"),
    sales: tr("Sales", "Vendas", "Ventas"),
  };
  const COLOR: Record<string, string> = {
    lots: "A3B18A",
    permits: "94A3B8",
    build: "F59E0B",
    sales: "22C55E",
    loan: NAVY,
  };
  const rows: Array<{ key: string; label: string; segments: Array<[number, number]> }> = [
    ...pp.phases.map((p) => ({ key: p.key, label: NAMES[p.key] ?? p.label, segments: p.segments })),
    ...(pp.loan
      ? [{ key: "loan", label: tr("Loan outstanding", "Loan em aberto", "Préstamo vigente"), segments: pp.loan.segments }]
      : []),
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
          cell("FFFFFF", labelW, tr("Month", "Mês", "Mes")),
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
    c.beds != null ? tr(`${c.beds} bed`, `${c.beds} quartos`, `${c.beds} hab.`) : null,
    c.baths != null ? tr(`${c.baths} bath`, `${c.baths} banheiros`, `${c.baths} baños`) : null,
    c.garage != null
      ? tr(`${c.garage}-car garage`, `garagem p/ ${c.garage} carros`, `garaje p/ ${c.garage} autos`)
      : null,
    c.livingSqft != null
      ? tr(
          `${c.livingSqft.toLocaleString("en-US")} SF living`,
          `${c.livingSqft.toLocaleString("en-US")} SF de área útil`,
          `${c.livingSqft.toLocaleString("en-US")} SF habitables`,
        )
      : null,
    c.builtSqft != null
      ? tr(
          `${c.builtSqft.toLocaleString("en-US")} SF built`,
          `${c.builtSqft.toLocaleString("en-US")} SF construídos`,
          `${c.builtSqft.toLocaleString("en-US")} SF construidos`,
        )
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

const underwritingOf = (c: ModelCard) =>
  tr("Sale price ", "Preço de venda ", "Precio de venta ") +
  money0(c.salePrice) +
  (c.ppsf != null
    ? tr(` · $${c.ppsf}/SF living`, ` · $${c.ppsf}/SF útil`, ` · $${c.ppsf}/SF habitable`)
    : "") +
  (c.percentile != null
    ? tr(
        ` — P${c.percentile} of closed new-construction sales in ${c.locations.join(", ")} (Section 3)`,
        ` — P${c.percentile} das vendas fechadas de casas novas em ${c.locations.join(", ")} (Seção 3)`,
        ` — P${c.percentile} de las ventas cerradas de obra nueva en ${c.locations.join(", ")} (Sección 3)`,
      )
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
    if (c.beds != null) specCells.push(spec(String(c.beds), tr("Bedrooms", "Quartos", "Habitaciones")));
    if (c.baths != null) specCells.push(spec(String(c.baths), tr("Bathrooms", "Banheiros", "Baños")));
    if (c.livingSqft != null)
      specCells.push(
        spec(`${c.livingSqft.toLocaleString("en-US")} SF`, tr("Living area", "Área útil", "Área habitable")),
      );
    if (c.builtSqft != null)
      specCells.push(
        spec(`${c.builtSqft.toLocaleString("en-US")} SF`, tr("Built area", "Área construída", "Área construida")),
      );
    if (c.garage != null)
      specCells.push(spec(tr(`${c.garage}-car`, `${c.garage} carros`, `${c.garage} autos`), tr("Garage", "Garagem", "Garaje")));
    if (c.buildMonths > 0)
      specCells.push(
        spec(tr(`${c.buildMonths} mo`, `${c.buildMonths} m`, `${c.buildMonths} m`), tr("Build time", "Prazo de obra", "Plazo de obra")),
      );
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
                    children: [
                      t(tr("UNDERWRITTEN IN THIS PROGRAM", "SUBSCRITO NESTE PROGRAMA", "SUSCRITO EN ESTE PROGRAMA"), {
                        size: 12,
                        bold: true,
                        color: GRAY,
                      }),
                    ],
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

// Narrativa aprovada 15/07: Expected é o caso-base declarado (benchmarked no §3), Stress
// dimensiona a captação, Upside é mercado forte + execução. Motor e app continuam OPT/REAL/CONS.
const scenarioNames = (): Record<string, string> => ({
  OPT: tr("Upside Case", "Cenário de Alta", "Escenario de Alza"),
  REAL: tr("Expected Case", "Cenário Esperado", "Escenario Esperado"),
  CONS: tr("Stress Case", "Cenário de Estresse", "Escenario de Estrés"),
});

const aiNote = (d: ReportData, prose: ReportProse) =>
  new Paragraph({
    spacing: { after: 200, line: 264 },
    children: [
      new TextRun({
        text: tr(
          `Commentary generated by the Manager's analysis platform from the ATTOM MLS extract of ${d.market.extractDate} and the figures of this Summary (model: ${prose.model}, ${prose.generatedAt}); every statement is limited to the data shown herein.`,
          `Comentário gerado pela plataforma de análise da Gestora a partir do extrato ATTOM MLS de ${d.market.extractDate} e dos números deste Resumo (modelo: ${prose.model}, ${prose.generatedAt}); toda afirmação se limita aos dados aqui apresentados.`,
          `Comentario generado por la plataforma de análisis del Administrador a partir del extracto ATTOM MLS de ${d.market.extractDate} y las cifras de este Resumen (modelo: ${prose.model}, ${prose.generatedAt}); toda afirmación se limita a los datos aquí presentados.`,
        ),
        font: FONT,
        size: 16,
        color: GRAY,
        italics: true,
      }),
    ],
  });

export function buildReportDocx(
  d: ReportData,
  recipient?: string,
  prose?: ReportProse | null,
  lang: ReportLang = "en",
): Document {
  LANG = lang; // helpers de módulo (gantt, ficha, aiNote…) leem via tr()
  const isClient = d.vehicleStructure === "CLIENT_ENTITY";
  const entityName =
    d.clientEntityName ||
    tr("the investor group's own entity", "a entidade própria do grupo de investidores", "la entidad propia del grupo inversor");
  // waterfall da Vixus por extenso: "up to 8% p.a. — 0%; 8–15% — 20%; above 15% — 35%"
  const tiersText = (() => {
    const ts = d.promoteTiers ?? [];
    if (!ts.length) return "";
    let prev: number | null = null;
    const parts = ts.map((t0) => {
      const range =
        t0.hurdlePct == null
          ? tr(`above ${prev ?? 0}% p.a.`, `acima de ${prev ?? 0}% a.a.`, `sobre ${prev ?? 0}% anual`)
          : prev == null
            ? tr(`up to ${t0.hurdlePct}% p.a.`, `até ${t0.hurdlePct}% a.a.`, `hasta ${t0.hurdlePct}% anual`)
            : tr(`${prev}–${t0.hurdlePct}% p.a.`, `${prev}–${t0.hurdlePct}% a.a.`, `${prev}–${t0.hurdlePct}% anual`);
      if (t0.hurdlePct != null) prev = t0.hurdlePct;
      return `${range} — ${t0.promotePct}%`;
    });
    return parts.join("; ");
  })();
  const SCEN = scenarioNames();
  const scenarioName = (s: { code: string; name: string }) => SCEN[s.code] ?? s.name;
  // remuneração da 4U por extenso, no idioma do documento (substitui d.compLabel)
  const compLabel =
    d.compMode === "PERFORMANCE"
      ? tr(
          `Performance — ${d.perfPct}% of net project profit, payable ${d.perfTiming === "PER_SALE" ? "per sale" : "at project completion"}, before investor split`,
          `Performance — ${d.perfPct}% do lucro líquido do projeto, pagos ${d.perfTiming === "PER_SALE" ? "por venda" : "na conclusão do projeto"}, antes da divisão com investidores`,
          `Performance — ${d.perfPct}% de la utilidad neta del proyecto, pagadero ${d.perfTiming === "PER_SALE" ? "por venta" : "al cierre del proyecto"}, antes de la distribución a inversores`,
        )
      : d.compMode === "PROMOTE"
        ? tr(
            "Promote — tiered share of profit above investor return hurdles (waterfall), payable at completion",
            "Promote — participação escalonada no lucro acima dos hurdles de retorno do investidor (waterfall), paga na conclusão",
            "Promote — participación escalonada en la utilidad sobre los umbrales de retorno del inversor (waterfall), pagadera al cierre",
          )
        : d.compMode === "OPEN_BOOK"
          ? tr(
              `Open book — actual construction cost plus a flat fee of $${Number(d.flatFeePerHouse).toLocaleString("en-US")} per home${d.hasPromote ? ", plus a promote above investor return hurdles" : ""}`,
              `Open book — custo real de obra mais taxa fixa de $${Number(d.flatFeePerHouse).toLocaleString("en-US")} por casa${d.hasPromote ? ", mais promote acima dos hurdles de retorno do investidor" : ""}`,
              `Open book — costo real de obra más una tarifa fija de $${Number(d.flatFeePerHouse).toLocaleString("en-US")} por casa${d.hasPromote ? ", más un promote sobre los umbrales de retorno del inversor" : ""}`,
            )
          : tr(
              "Contractor fee — fixed fee per home embedded in the construction contract",
              "Contractor fee — taxa fixa por casa embutida no contrato de obra",
              "Contractor fee — tarifa fija por casa incluida en el contrato de obra",
            );
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
      ? d.cycles
          .map((c) =>
            tr(
              `Cycle ${c.cycle} — ${c.homes} home${c.homes > 1 ? "s" : ""}`,
              `Ciclo ${c.cycle} — ${c.homes} casa${c.homes > 1 ? "s" : ""}`,
              `Ciclo ${c.cycle} — ${c.homes} casa${c.homes > 1 ? "s" : ""}`,
            ),
          )
          .join("; ")
      : tr("single construction cycle", "ciclo único de obra", "ciclo único de obra");
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
        children: [
          new TextRun({
            text: tr("INVESTMENT SUMMARY", "RESUMO DO INVESTIMENTO", "RESUMEN DE INVERSIÓN"),
            font: FONT,
            size: 60,
            bold: true,
            color: "FFFFFF",
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: d.simName, font: FONT, size: 30, bold: true, color: "D9E2F0" })],
      }),
      // Entidade na capa (mock aprovado 15/07): LLC dedicada nomeada, "to be formed" quando
      // vazia, ou "Prepared for <entidade do grupo>" no caso CLIENT_ENTITY
      ...(isClient
        ? d.clientEntityName
          ? [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 100 },
                children: [
                  new TextRun({
                    text: tr(
                      `Prepared for ${d.clientEntityName}`,
                      `Preparado para ${d.clientEntityName}`,
                      `Preparado para ${d.clientEntityName}`,
                    ),
                    font: FONT,
                    size: 21,
                    color: "9FC0E8",
                  }),
                ],
              }),
            ]
          : []
        : [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 100 },
              children: [
                new TextRun({
                  text: d.vehicleEntityName
                    ? tr(
                        `${d.vehicleEntityName} — a dedicated investment vehicle`,
                        `${d.vehicleEntityName} — veículo de investimento dedicado`,
                        `${d.vehicleEntityName} — vehículo de inversión dedicado`,
                      )
                    : tr(
                        "Dedicated Florida LLC — to be formed",
                        "LLC dedicada na Flórida — a constituir",
                        "LLC dedicada en Florida — a constituirse",
                      ),
                  font: FONT,
                  size: 21,
                  color: "9FC0E8",
                }),
              ],
            }),
          ]),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: tr(
              "Residential Build-to-Sell Program — Central & Southwest Florida",
              "Programa Residencial Build-to-Sell — Flórida Central e Sudoeste",
              "Programa Residencial Build-to-Sell — Florida Central y Suroeste",
            ),
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
        new TextRun({
          text: isClient
            ? tr(
                "4U Custom Homes — Builder    ·    Vixus Investment — Development Manager",
                "4U Custom Homes — Construtora    ·    Vixus Investment — Development Manager",
                "4U Custom Homes — Constructora    ·    Vixus Investment — Development Manager",
              )
            : tr(
                "4U Custom Homes — Builder    ·    Vixus Investment — Manager",
                "4U Custom Homes — Construtora    ·    Vixus Investment — Gestora",
                "4U Custom Homes — Constructora    ·    Vixus Investment — Administrador",
              ),
          font: FONT,
          size: 22,
          color: GRAY,
        }),
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
      children: [
        new TextRun({
          text: tr(
            "CONFIDENTIAL — FOR DISCUSSION PURPOSES ONLY",
            "CONFIDENCIAL — APENAS PARA FINS DE DISCUSSÃO",
            "CONFIDENCIAL — SOLO PARA FINES DE DISCUSIÓN",
          ),
          font: FONT,
          size: 20,
          bold: true,
          color: "991B1B",
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80 },
      children: [
        t(
          `${d.generatedAt}${recipient ? tr(`  ·  Prepared for ${recipient}`, `  ·  Preparado para ${recipient}`, `  ·  Preparado para ${recipient}`) : ""}`,
          { color: GRAY },
        ),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),

    // ── IMPORTANT NOTICES ──
    h1(tr("Important Notices", "Avisos Importantes", "Avisos Importantes")),
    // PT/ES: ressalva de tradução livre ANTES de tudo — o inglês (validado c/ advogado) prevalece
    ...(lang !== "en"
      ? [
          body([
            t(
              tr(
                "",
                "Este documento é uma tradução livre, fornecida por conveniência, do Investment Summary preparado em inglês. Em caso de qualquer divergência ou ambiguidade, a versão em inglês prevalece integralmente.",
                "Este documento es una traducción libre, provista por conveniencia, del Investment Summary preparado en inglés. En caso de cualquier divergencia o ambigüedad, la versión en inglés prevalece íntegramente.",
              ),
              { bold: true },
            ),
          ]),
        ]
      : []),
    body(
      tr(
        "This Investment Summary (the “Summary”) is furnished on a confidential basis to a limited number of sophisticated prospective investors for the sole purpose of evaluating a potential investment in the project described herein (the “Project”). It is not an offer to sell, or a solicitation of an offer to buy, any security. Any such offer will be made only through definitive offering documents (including a private placement memorandum, operating agreement and subscription agreement), which will contain material information not included herein and will supersede this Summary in its entirety.",
        "Este Resumo do Investimento (o “Resumo”) é fornecido em caráter confidencial a um número limitado de investidores sofisticados, com o único propósito de avaliar um potencial investimento no projeto aqui descrito (o “Projeto”). Não constitui oferta de venda, nem solicitação de oferta de compra, de qualquer valor mobiliário. Qualquer oferta será feita exclusivamente por meio dos documentos definitivos da operação (incluindo private placement memorandum, operating agreement e subscription agreement), que conterão informações relevantes não incluídas aqui e prevalecerão integralmente sobre este Resumo.",
        "Este Resumen de Inversión (el “Resumen”) se entrega con carácter confidencial a un número limitado de inversores sofisticados, con el único propósito de evaluar una posible inversión en el proyecto aquí descrito (el “Proyecto”). No constituye una oferta de venta ni una solicitud de oferta de compra de ningún valor. Cualquier oferta se realizará exclusivamente mediante los documentos definitivos de la operación (incluyendo el private placement memorandum, el operating agreement y el subscription agreement), que contendrán información relevante no incluida aquí y prevalecerán íntegramente sobre este Resumen.",
      ),
    ),
    ...(isClient
      ? [
          body(
            tr(
              `This Summary is prepared for ${entityName}, an entity owned and controlled by the investor group, in connection with Vixus Investment's engagement as Development Manager and 4U Custom Homes' engagement as builder. Nothing herein constitutes an offer or sale of securities by Vixus Investment or 4U Custom Homes; the formation, governance and taxation of the investor entity — and any offering of interests within it — are matters for that entity and its own legal and tax advisors. An investment in the program involves a high degree of risk, including the possible loss of the entire investment.`,
              `Este Resumo é preparado para ${entityName}, entidade detida e controlada pelo grupo de investidores, no contexto da contratação da Vixus Investment como Development Manager e da 4U Custom Homes como construtora. Nada aqui constitui oferta ou venda de valores mobiliários pela Vixus Investment ou pela 4U Custom Homes; a constituição, a governança e a tributação da entidade investidora — e qualquer oferta de participações dentro dela — são matérias da própria entidade e de seus assessores jurídicos e tributários. O investimento no programa envolve alto grau de risco, incluindo a possível perda de todo o investimento.`,
              `Este Resumen se prepara para ${entityName}, entidad de propiedad y bajo control del grupo inversor, en el contexto de la contratación de Vixus Investment como Development Manager y de 4U Custom Homes como constructora. Nada de lo aquí contenido constituye oferta o venta de valores por parte de Vixus Investment o 4U Custom Homes; la constitución, gobernanza y tributación de la entidad inversora — y cualquier oferta de participaciones dentro de ella — son asuntos de dicha entidad y de sus propios asesores legales y fiscales. La inversión en el programa implica un alto grado de riesgo, incluida la posible pérdida de la totalidad de la inversión.`,
            ),
          ),
        ]
      : [
          body(
            tr(
              "Securities, if and when offered, are expected to be offered in reliance on the exemption provided by Rule 506(b) of Regulation D under the Securities Act of 1933, as amended, and applicable Florida law, to investors with whom the sponsor has a pre-existing substantive relationship. Securities have not been and will not be registered with the U.S. Securities and Exchange Commission or any state securities authority, are subject to restrictions on transferability and resale, and involve a high degree of risk, including the possible loss of the entire investment.",
              "Os valores mobiliários, se e quando ofertados, deverão ser ofertados com base na isenção da Rule 506(b) do Regulation D do Securities Act de 1933, conforme alterado, e na legislação aplicável da Flórida, a investidores com os quais o sponsor mantém relacionamento substantivo pré-existente. Os valores mobiliários não foram e não serão registrados na U.S. Securities and Exchange Commission nem em qualquer autoridade estadual, estão sujeitos a restrições de transferência e revenda, e envolvem alto grau de risco, incluindo a possível perda de todo o investimento.",
              "Los valores, si se ofrecen y cuando se ofrezcan, se ofrecerían al amparo de la exención de la Rule 506(b) del Regulation D del Securities Act de 1933, según enmendado, y de la ley aplicable de Florida, a inversores con quienes el sponsor mantiene una relación sustantiva preexistente. Los valores no han sido ni serán registrados ante la U.S. Securities and Exchange Commission ni ante ninguna autoridad estatal, están sujetos a restricciones de transferencia y reventa, e implican un alto grado de riesgo, incluida la posible pérdida de la totalidad de la inversión.",
            ),
          ),
        ]),
    body(
      tr(
        "This Summary contains forward-looking statements, projections and scenario analyses that are based on assumptions believed to be reasonable as of the date hereof. The “Expected Case” presented herein is the Manager's base operating case — the outcome the Manager considers most likely — and not a guarantee or a promise of performance; the “Stress Case” is a deliberately adverse scenario used to size the offering. Projected and expected returns are hypothetical, are not guarantees of future performance, and actual results will differ — possibly materially. Unless expressly stated otherwise, all projected returns are presented net of builder compensation and project-level fees described herein, and before any taxes payable by investors. Recipients should conduct their own due diligence and consult their own legal, tax and financial advisors.",
        "Este Resumo contém declarações prospectivas, projeções e análises de cenários baseadas em premissas consideradas razoáveis na data deste documento. O “Cenário Esperado” aqui apresentado é o caso-base operacional da Gestora — o desfecho que a Gestora considera mais provável — e não uma garantia ou promessa de desempenho; o “Cenário de Estresse” é um cenário deliberadamente adverso, usado para dimensionar a captação. Retornos projetados e esperados são hipotéticos, não são garantia de desempenho futuro, e os resultados reais serão diferentes — possivelmente de forma relevante. Salvo indicação expressa em contrário, todos os retornos projetados são apresentados líquidos da remuneração da construtora e das taxas do projeto aqui descritas, e antes de quaisquer tributos devidos pelos investidores. Os destinatários devem conduzir sua própria diligência e consultar seus próprios assessores jurídicos, tributários e financeiros.",
        "Este Resumen contiene declaraciones prospectivas, proyecciones y análisis de escenarios basados en supuestos considerados razonables a la fecha de este documento. El “Escenario Esperado” aquí presentado es el caso base operativo del Administrador — el desenlace que el Administrador considera más probable — y no una garantía ni promesa de desempeño; el “Escenario de Estrés” es un escenario deliberadamente adverso, utilizado para dimensionar la captación. Los retornos proyectados y esperados son hipotéticos, no garantizan desempeño futuro, y los resultados reales serán diferentes — posiblemente de forma material. Salvo indicación expresa en contrario, todos los retornos proyectados se presentan netos de la compensación de la constructora y de las tarifas del proyecto aquí descritas, y antes de cualquier impuesto a cargo de los inversores. Los destinatarios deben realizar su propia diligencia y consultar a sus propios asesores legales, fiscales y financieros.",
      ),
    ),
    new Paragraph({ children: [new PageBreak()] }),

    // ── INVESTMENT HIGHLIGHTS (aprovado 15/07) — o investidor decide em segundos se
    // continua lendo; TODOS os bullets são condicionais às variáveis da simulação ──
    h1(tr("Investment Highlights", "Destaques do Investimento", "Aspectos Destacados de la Inversión")),
    body(
      [
        t(tr(`Why invest in ${d.simName}?`, `Por que investir no ${d.simName}?`, `¿Por qué invertir en ${d.simName}?`), {
          bold: true,
          size: 24,
          color: NAVY,
        }),
      ],
      {
        alignment: AlignmentType.LEFT,
        spacing: { after: 220 },
      },
    ),
    // Ordem psicológica (feedback 15/07): primeiro compra-se a EMPRESA, depois a estrutura
    // O histórico é da 4U (Construtora) — nunca do veículo/entidade do cliente (16/07)
    bullet([
      t(
        tr("Proven builder track record — ", "Histórico comprovado da construtora — ", "Trayectoria comprobada de la constructora — "),
        { bold: true },
      ),
      t(
        tr(
          "4U Custom Homes, the program's Builder, has delivered 500+ homes and $130M+ in accumulated sales volume since 2019, across six Florida regions (Section 2).",
          "a 4U Custom Homes, construtora do programa, entregou mais de 500 casas e mais de $130M em volume de vendas acumulado desde 2019, em seis regiões da Flórida (Seção 2).",
          "4U Custom Homes, constructora del programa, ha entregado más de 500 casas y más de $130M en volumen de ventas acumulado desde 2019, en seis regiones de Florida (Sección 2).",
        ),
      ),
    ]),
    bullet([
      t(
        tr(
          "Capital sized for the Stress Case — ",
          "Capital dimensionado pelo Cenário de Estresse — ",
          "Capital dimensionado por el Escenario de Estrés — ",
        ),
        { bold: true },
      ),
      t(
        tr(
          "investors fund the program through its stressed scenario, not its expected outcome.",
          "os investidores financiam o programa pelo cenário estressado, não pelo desfecho esperado.",
          "los inversores financian el programa por su escenario estresado, no por su desenlace esperado.",
        ),
      ),
    ]),
    ...(d.compMode === "OPEN_BOOK"
      ? [
          bullet([
            t(tr("Open-book construction — ", "Obra em open book — ", "Obra a libro abierto — "), { bold: true }),
            t(
              tr(
                "the Builder's margin is fixed and fully disclosed per home; every cost is auditable against invoices.",
                "a margem da construtora é fixa e integralmente divulgada por casa; todo custo é auditável contra notas fiscais.",
                "el margen de la constructora es fijo y totalmente divulgado por casa; cada costo es auditable contra facturas.",
              ),
            ),
          ]),
        ]
      : d.compMode === "PERFORMANCE" || d.compMode === "PROMOTE"
        ? [
            bullet([
              t(
                tr("Builder paid on performance — ", "Construtora remunerada por performance — ", "Constructora remunerada por desempeño — "),
                { bold: true },
              ),
              t(
                tr(
                  "builder compensation is subordinated to realized project profit; no fee is payable regardless of outcome.",
                  "a remuneração da construtora é subordinada ao lucro realizado do projeto; nenhuma taxa é devida independentemente do resultado.",
                  "la compensación de la constructora está subordinada a la utilidad realizada del proyecto; no se paga tarifa alguna con independencia del resultado.",
                ),
              ),
            ]),
          ]
        : [
            bullet([
              t(
                tr("Fixed-price construction contract — ", "Contrato de obra a preço fixo — ", "Contrato de obra a precio fijo — "),
                { bold: true },
              ),
              t(
                tr(
                  "construction cost risk within the contract is borne by the Builder, not the investors.",
                  "o risco de custo de obra dentro do contrato é da construtora, não dos investidores.",
                  "el riesgo de costo de obra dentro del contrato lo asume la constructora, no los inversores.",
                ),
              ),
            ]),
          ]),
    ...(isBank
      ? [
          bullet([
            t(
              tr("Disciplined construction leverage — ", "Alavancagem de obra disciplinada — ", "Apalancamiento de obra disciplinado — "),
              { bold: true },
            ),
            t(
              tr(
                "interest accrues on drawn balances only, and the facility is modeled line-by-line from executed term sheets (Section 5).",
                "os juros incidem apenas sobre o saldo sacado, e o financiamento é modelado linha a linha a partir de term sheets assinados (Seção 5).",
                "los intereses se devengan solo sobre el saldo dispuesto, y la facilidad se modela línea por línea a partir de term sheets firmados (Sección 5).",
              ),
            ),
          ]),
        ]
      : [
          bullet([
            t(tr("All-equity program — ", "Programa 100% equity — ", "Programa 100% capital propio — "), { bold: true }),
            t(
              tr(
                "no construction debt: no lender fees, no interest-rate exposure, no maturity risk.",
                "sem dívida de obra: sem taxas de banco, sem exposição a juros, sem risco de vencimento.",
                "sin deuda de obra: sin comisiones bancarias, sin exposición a tasas de interés, sin riesgo de vencimiento.",
              ),
            ),
          ]),
        ]),
    ...(d.hasPromote
      ? [
          bullet([
            t(
              tr("Preferred-return waterfall — ", "Waterfall com retorno preferencial — ", "Waterfall con retorno preferente — "),
              { bold: true },
            ),
            t(
              tr(
                "the Development Manager is compensated only above investor return hurdles; investors are paid first.",
                "o Development Manager só é remunerado acima dos hurdles de retorno do investidor; os investidores recebem primeiro.",
                "el Development Manager solo es compensado por encima de los umbrales de retorno del inversor; los inversores cobran primero.",
              ),
            ),
          ]),
        ]
      : []),
    ...(isClient
      ? [
          bullet([
            t(
              tr("Investor-owned entity — ", "Entidade do próprio grupo investidor — ", "Entidad propia del grupo inversor — "),
              { bold: true },
            ),
            t(
              tr(
                "the group holds the money and controls its own vehicle; Vixus runs the program as Development Manager.",
                "o grupo detém o dinheiro e controla seu próprio veículo; a Vixus opera o programa como Development Manager.",
                "el grupo custodia el dinero y controla su propio vehículo; Vixus opera el programa como Development Manager.",
              ),
            ),
          ]),
        ]
      : [
          bullet([
            t(
              tr("Dedicated LLC for this program — ", "LLC dedicada a este programa — ", "LLC dedicada a este programa — "),
              { bold: true },
            ),
            t(
              tr(
                "one vehicle per program, never reused; fixed $1,000 units with no later-stage dilution.",
                "um veículo por programa, nunca reutilizado; cotas fixas de $1.000, sem diluição posterior.",
                "un vehículo por programa, nunca reutilizado; unidades fijas de $1,000, sin dilución posterior.",
              ),
            ),
          ]),
        ]),
    bullet([
      t(
        tr("Proprietary technology platform — ", "Plataforma tecnológica proprietária — ", "Plataforma tecnológica propietaria — "),
        { bold: true },
      ),
      t(
        tr(
          "every capital call, construction draw and distribution is tracked on the sponsor's own platform; this Summary is generated from it (Section 2).",
          "cada chamada de capital, draw de obra e distribuição é registrada na plataforma do próprio sponsor; este Resumo é gerado a partir dela (Seção 2).",
          "cada llamada de capital, desembolso de obra y distribución se registra en la plataforma del propio sponsor; este Resumen se genera a partir de ella (Sección 2).",
        ),
      ),
    ]),
    bullet([
      t(
        tr(
          "Underwriting benchmarked against closed transactions — ",
          "Premissas comparadas com transações fechadas — ",
          "Supuestos comparados con transacciones cerradas — ",
        ),
        { bold: true },
      ),
      t(
        tr(
          "assumptions are positioned against sold MLS comparables from a weekly ATTOM data feed (Section 3), not asking prices.",
          "as premissas são posicionadas contra comparáveis VENDIDOS do MLS, de um feed semanal da ATTOM (Seção 3) — não preços de anúncio.",
          "los supuestos se posicionan contra comparables VENDIDOS del MLS, de un feed semanal de ATTOM (Sección 3) — no precios de lista.",
        ),
      ),
    ]),
    bullet([
      t(tr("Monthly investor reporting — ", "Relatórios mensais ao investidor — ", "Informes mensuales al inversor — "), {
        bold: true,
      }),
      t(
        tr(
          "statements are generated directly from the operating ledger, not from separately prepared spreadsheets.",
          "os extratos são gerados diretamente do ledger operacional, não de planilhas preparadas à parte.",
          "los estados se generan directamente del ledger operativo, no de planillas preparadas por separado.",
        ),
      ),
    ]),
    ...(d.cycles.length > 1
      ? [
          bullet([
            t(
              tr(
                `Capital recycling across ${d.cycles.length} chained cycles — `,
                `Reciclagem de capital em ${d.cycles.length} ciclos encadeados — `,
                `Reciclaje de capital en ${d.cycles.length} ciclos encadenados — `,
              ),
              { bold: true },
            ),
            t(
              tr(
                "the same equity base produces multiple homes, which is what drives the projected IRR (Section 4).",
                "a mesma base de capital produz múltiplas casas — é isso que impulsiona a TIR projetada (Seção 4).",
                "la misma base de capital produce múltiples casas — eso es lo que impulsa la TIR proyectada (Sección 4).",
              ),
            ),
          ]),
        ]
      : []),
    new Paragraph({ children: [new PageBreak()] }),

    // ── 1. EXECUTIVE SUMMARY ──
    h1(tr("1. Executive Summary", "1. Sumário Executivo", "1. Resumen Ejecutivo")),
    body(
      tr(
        "The Project is a residential build-to-sell program executed by 4U Custom Homes (the “Builder”) and administered by Vixus Investment (the “Manager”) in high-absorption submarkets of Central and Southwest Florida. ",
        "O Projeto é um programa residencial build-to-sell executado pela 4U Custom Homes (a “Construtora”) e administrado pela Vixus Investment (a “Gestora”) em submercados de alta absorção da Flórida Central e Sudoeste. ",
        "El Proyecto es un programa residencial build-to-sell ejecutado por 4U Custom Homes (la “Constructora”) y administrado por Vixus Investment (el “Administrador”) en submercados de alta absorción de Florida Central y Suroeste. ",
      ) +
        (d.cycles.length > 1
          ? tr(
              "Investor capital funds land acquisition and vertical construction of single-family homes that are sold upon completion; capital is recycled through consecutive, pre-permitted construction cycles (the “Pipeline”), so that the same equity base produces multiple homes over the life of the program.",
              "O capital do investidor financia a aquisição de lotes e a construção vertical de casas unifamiliares vendidas na conclusão; o capital é reciclado por ciclos consecutivos e pré-licenciados de obra (a “Esteira”), de modo que a mesma base de capital produz múltiplas casas ao longo do programa.",
              "El capital del inversor financia la adquisición de lotes y la construcción vertical de casas unifamiliares que se venden al concluirse; el capital se recicla en ciclos consecutivos y pre-permisados de obra (el “Pipeline”), de modo que la misma base de capital produce múltiples casas a lo largo del programa.",
            )
          : tr(
              "Investor capital funds land acquisition and vertical construction of single-family homes in a single construction wave with staggered starts; capital is returned as each home sells and closes.",
              "O capital do investidor financia a aquisição de lotes e a construção vertical de casas unifamiliares em uma única onda de obra com inícios escalonados; o capital retorna à medida que cada casa é vendida e escriturada.",
              "El capital del inversor financia la adquisición de lotes y la construcción vertical de casas unifamiliares en una sola ola de obra con inicios escalonados; el capital retorna a medida que cada casa se vende y se escritura.",
            )),
    ),
    // Bloco de retorno (substitui a linha "Projected net IRR (base case)" que liderava
    // com o número do stress): Expected primeiro, em navy — lê-se da esquerda p/ direita
    kpiStrip([
      {
        label: tr("Expected Investor IRR (net)", "TIR Esperada do Investidor (líquida)", "TIR Esperada del Inversor (neta)"),
        value: pct(expected.irrAnnual),
        sub: tr(
          "base operating case · most likely outcome",
          "caso-base operacional · desfecho mais provável",
          "caso base operativo · desenlace más probable",
        ),
        main: true,
      },
      {
        label: tr("Stress-Tested Downside", "Piso Testado sob Estresse", "Piso Probado bajo Estrés"),
        value: pct(stress.irrAnnual),
        sub:
          tr(
            "price discounts, cost overruns, extended timelines",
            "descontos de preço, estouros de custo, prazos estendidos",
            "descuentos de precio, sobrecostos, plazos extendidos",
          ) + (stress.profit >= 0 ? tr(" — capital preserved", " — capital preservado", " — capital preservado") : ""),
      },
      {
        label: tr("Upside Potential", "Potencial de Alta", "Potencial de Alza"),
        value: pct(upside.irrAnnual),
        sub: tr(
          "strong market conditions & execution",
          "mercado forte + execução",
          "mercado fuerte + ejecución",
        ),
      },
    ]),
    ...(stressSized
      ? [
          sealBand(
            tr(
              "🛡  CAPITAL SIZED USING THE STRESS-TESTED SCENARIO",
              "🛡  CAPITAL DIMENSIONADO PELO CENÁRIO TESTADO SOB ESTRESSE",
              "🛡  CAPITAL DIMENSIONADO POR EL ESCENARIO PROBADO BAJO ESTRÉS",
            ),
          ),
        ]
      : []),
    new Paragraph({
      spacing: { before: 100, after: 220, line: 252 },
      children: [
        new TextRun({
          text:
            (d.trackRecord.sample.n > 0
              ? tr(
                  "Expected Case assumptions are benchmarked against closed market transactions (Section 3) and the Builder's realized performance on closed projects (Section 2).",
                  "As premissas do Cenário Esperado são comparadas com transações fechadas de mercado (Seção 3) e com o desempenho realizado da Construtora em projetos concluídos (Seção 2).",
                  "Los supuestos del Escenario Esperado se comparan con transacciones cerradas de mercado (Sección 3) y con el desempeño realizado de la Constructora en proyectos concluidos (Sección 2).",
                )
              : tr(
                  "Expected Case assumptions are benchmarked against closed market transactions (Section 3) and the Builder's delivery history of 500+ homes (Section 2).",
                  "As premissas do Cenário Esperado são comparadas com transações fechadas de mercado (Seção 3) e com o histórico de mais de 500 casas entregues pela Construtora (Seção 2).",
                  "Los supuestos del Escenario Esperado se comparan con transacciones cerradas de mercado (Sección 3) y con el historial de más de 500 casas entregadas por la Constructora (Sección 2).",
                )) +
            tr(" Expected returns are not guaranteed.", " Retornos esperados não são garantidos.", " Los retornos esperados no están garantizados.") +
            (stressSized
              ? tr(
                  " The raise is sized to the Stress Case — investors fund the program through its stressed scenario, not its expected outcome.",
                  " A captação é dimensionada pelo Cenário de Estresse — os investidores financiam o programa pelo cenário estressado, não pelo desfecho esperado.",
                  " La captación se dimensiona por el Escenario de Estrés — los inversores financian el programa por su escenario estresado, no por su desenlace esperado.",
                )
              : ""),
          font: FONT,
          size: 16,
          color: GRAY,
          italics: true,
        }),
      ],
    }),
    h2(tr("Investment at a Glance", "O Investimento em um Relance", "La Inversión de un Vistazo")),
    kvTable([
      [
        tr("Program", "Programa", "Programa"),
        tr(
          `${nHomes} home${nHomes > 1 ? "s" : ""} in ${d.cycles.length > 1 ? `${d.cycles.length} chained cycles` : "a single cycle"} across ${d.locations.join(", ")}`,
          `${nHomes} casa${nHomes > 1 ? "s" : ""} em ${d.cycles.length > 1 ? `${d.cycles.length} ciclos encadeados` : "ciclo único"} em ${d.locations.join(", ")}`,
          `${nHomes} casa${nHomes > 1 ? "s" : ""} en ${d.cycles.length > 1 ? `${d.cycles.length} ciclos encadenados` : "un ciclo único"} en ${d.locations.join(", ")}`,
        ),
      ],
      [
        tr("Vehicle", "Veículo", "Vehículo"),
        isClient
          ? tr(
              `${entityName} — owned and controlled by the investor group (structure selected by the group for its own legal and tax profile); Vixus Investment engaged as Development Manager`,
              `${entityName} — detida e controlada pelo grupo investidor (estrutura escolhida pelo grupo para seu próprio perfil jurídico e tributário); Vixus Investment contratada como Development Manager`,
              `${entityName} — de propiedad y bajo control del grupo inversor (estructura elegida por el grupo para su propio perfil legal y fiscal); Vixus Investment contratada como Development Manager`,
            )
          : d.vehicleEntityName
            ? tr(
                `${d.vehicleEntityName} — dedicated Florida limited liability company; single class of non-voting investor units of $1,000 each`,
                `${d.vehicleEntityName} — LLC dedicada na Flórida; classe única de cotas sem voto de $1.000 cada`,
                `${d.vehicleEntityName} — LLC dedicada en Florida; clase única de unidades sin voto de $1,000 cada una`,
              )
            : tr(
                "Dedicated Florida limited liability company (to be formed for this program); single class of non-voting investor units of $1,000 each",
                "LLC dedicada na Flórida (a constituir para este programa); classe única de cotas sem voto de $1.000 cada",
                "LLC dedicada en Florida (a constituirse para este programa); clase única de unidades sin voto de $1,000 cada una",
              ),
      ],
      [
        tr("Projected duration (Expected Case)", "Duração projetada (Cenário Esperado)", "Duración proyectada (Escenario Esperado)"),
        tr(`${months(expected.durationDays)} months`, `${months(expected.durationDays)} meses`, `${months(expected.durationDays)} meses`),
      ],
      [
        tr("Peak invested capital (Expected Case)", "Pico de capital investido (Cenário Esperado)", "Pico de capital invertido (Escenario Esperado)"),
        money0(expected.peakCapital),
      ],
      [
        tr("Target raise", "Captação-alvo", "Captación objetivo"),
        stressSized
          ? tr(
              `${money0(stress.peakCapital)} — sized using the Stress Case (Section 6)`,
              `${money0(stress.peakCapital)} — dimensionada pelo Cenário de Estresse (Seção 6)`,
              `${money0(stress.peakCapital)} — dimensionada por el Escenario de Estrés (Sección 6)`,
            )
          : tr(
              `${money0(expected.peakCapital)} (Expected Case peak capital)`,
              `${money0(expected.peakCapital)} (pico de capital do Cenário Esperado)`,
              `${money0(expected.peakCapital)} (pico de capital del Escenario Esperado)`,
            ),
      ],
      [
        tr("Projected equity multiple (Expected Case)", "Múltiplo de capital projetado (Cenário Esperado)", "Múltiplo de capital proyectado (Escenario Esperado)"),
        expected.equityMultiple == null ? "—" : `${expected.equityMultiple.toFixed(2)}x`,
      ],
      [tr("Builder compensation", "Remuneração da construtora", "Compensación de la constructora"), compLabel],
      ...(d.hasPromote
        ? [
            [
              tr("Developer compensation", "Remuneração do developer", "Compensación del developer"),
              tr(
                `Vixus Investment (Development Manager) — waterfall payable at completion, only above investor return hurdles: ${tiersText}`,
                `Vixus Investment (Development Manager) — waterfall pago na conclusão, somente acima dos hurdles de retorno do investidor: ${tiersText}`,
                `Vixus Investment (Development Manager) — waterfall pagadero al cierre, solo por encima de los umbrales de retorno del inversor: ${tiersText}`,
              ),
            ] as [string, string],
          ]
        : []),
      [
        tr("Construction financing", "Financiamento da obra", "Financiamiento de obra"),
        isBank
          ? tr(
              `${d.bankName ?? "Construction facility"} — interest on drawn balance only${d.bankTerms ? `; up to ${d.bankTerms.ltcBuildPct}% LTC / ${d.bankTerms.ltvPct}% LTV, ${d.bankTerms.aprEffectivePct.toFixed(2)}% APR, ${d.bankTerms.termMonths}-month term` : ""}`,
              `${d.bankName ?? "Linha de construção"} — juros apenas sobre o saldo sacado${d.bankTerms ? `; até ${d.bankTerms.ltcBuildPct}% LTC / ${d.bankTerms.ltvPct}% LTV, ${d.bankTerms.aprEffectivePct.toFixed(2)}% APR, prazo de ${d.bankTerms.termMonths} meses` : ""}`,
              `${d.bankName ?? "Línea de construcción"} — intereses solo sobre el saldo dispuesto${d.bankTerms ? `; hasta ${d.bankTerms.ltcBuildPct}% LTC / ${d.bankTerms.ltvPct}% LTV, ${d.bankTerms.aprEffectivePct.toFixed(2)}% APR, plazo de ${d.bankTerms.termMonths} meses` : ""}`,
            )
          : tr(
              "All-equity program — no construction debt",
              "Programa 100% equity — sem dívida de obra",
              "Programa 100% capital propio — sin deuda de obra",
            ),
      ],
      [
        tr("Distributions", "Distribuições", "Distribuciones"),
        tr(
          "Return of capital as sales close, under the cash-first rule; profit distributed at program completion",
          "Devolução de capital à medida que as vendas fecham, sob a regra caixa-primeiro; lucro distribuído na conclusão do programa",
          "Devolución de capital a medida que cierran las ventas, bajo la regla caja-primero; utilidad distribuida al concluir el programa",
        ),
      ],
      [
        tr("Reporting", "Relatórios", "Informes"),
        tr(
          "Investor portal with monthly statements, per-home budget vs. actual, and bank reconciliation",
          "Portal do investidor com extratos mensais, orçado × realizado por casa e conciliação bancária",
          "Portal del inversor con estados mensuales, presupuesto vs. real por casa y conciliación bancaria",
        ),
      ],
    ]),
    body(""),
    body([
      t(
        tr(
          "The financial model underlying this Summary is maintained on the Manager’s proprietary platform and has been ",
          "O modelo financeiro por trás deste Resumo é mantido na plataforma proprietária da Gestora e foi ",
          "El modelo financiero detrás de este Resumen se mantiene en la plataforma propietaria del Administrador y ha sido ",
        ),
      ),
      t(
        tr(
          "validated against the actual bank statement of a completed construction facility",
          "validado contra o extrato bancário real de um financiamento de obra concluído",
          "validado contra el estado bancario real de una facilidad de obra concluida",
        ),
        { bold: true },
      ),
      t(
        tr(
          " — fees reproduced to the cent and interest accruals within a fraction of one percent — and every projection in this document closes to the cent: sources and uses reconcile exactly to projected investor profit (Appendix A.4).",
          " — taxas reproduzidas ao centavo e juros com desvio de fração de um por cento — e toda projeção deste documento fecha ao centavo: origens e aplicações conciliam exatamente com o lucro projetado do investidor (Apêndice A.4).",
          " — comisiones reproducidas al centavo e intereses con desvío de una fracción del uno por ciento — y cada proyección de este documento cierra al centavo: orígenes y aplicaciones concilian exactamente con la utilidad proyectada del inversor (Apéndice A.4).",
        ),
      ),
    ]),

    // ── 2. SPONSOR ──
    h1(tr("2. Sponsor & Track Record", "2. Sponsor e Histórico", "2. Sponsor e Historial")),
    // Números grandes primeiro (feedback 15/07) — o investidor compra a empresa antes da casa
    bigStatGrid([
      { value: "500+", label: tr("Homes delivered", "Casas entregues", "Casas entregadas") },
      { value: "$130M+", label: tr("Sales volume", "Volume de vendas", "Volumen de ventas") },
      { value: "6", label: tr("Florida markets", "Mercados na Flórida", "Mercados en Florida") },
      { value: "2019", label: tr("Operating since", "Em operação desde", "Operando desde") },
    ]),
    body(""),
    h2(tr("4U Custom Homes — the Builder", "4U Custom Homes — a Construtora", "4U Custom Homes — la Constructora")),
    bullet([
      t(
        tr(
          "Founded in 2019; headquartered in Orlando, Florida. Over ",
          "Fundada em 2019; sediada em Orlando, Flórida. Mais de ",
          "Fundada en 2019; con sede en Orlando, Florida. Más de ",
        ),
      ),
      t(tr("500 homes delivered", "500 casas entregues", "500 casas entregadas"), { bold: true }),
      t(tr(" and more than ", " e mais de ", " y más de ")),
      t(
        tr(
          "$130 million in accumulated sales volume",
          "$130 milhões em volume de vendas acumulado",
          "$130 millones en volumen de ventas acumulado",
        ),
        { bold: true },
      ),
      t("."),
    ]),
    bullet(
      tr(
        "Active in six strategic regions: Marion Oaks (Ocala), Citrus Springs, North Port, Port Charlotte, Poinciana and Rotonda West.",
        "Ativa em seis regiões estratégicas: Marion Oaks (Ocala), Citrus Springs, North Port, Port Charlotte, Poinciana e Rotonda West.",
        "Activa en seis regiones estratégicas: Marion Oaks (Ocala), Citrus Springs, North Port, Port Charlotte, Poinciana y Rotonda West.",
      ),
    ),
    bullet([
      t(
        tr(
          "Standardized product line (Arpoador, Copacabana, Leblon, Maragogi, Ubatuba, among others) with an average ",
          "Linha de produto padronizada (Arpoador, Copacabana, Leblon, Maragogi, Ubatuba, entre outros) com ciclo médio de ",
          "Línea de producto estandarizada (Arpoador, Copacabana, Leblon, Maragogi, Ubatuba, entre otros) con un ciclo promedio de ",
        ),
      ),
      t(
        tr("five-month construction cycle", "cinco meses de obra", "cinco meses de obra"),
        { bold: true },
      ),
      t(
        tr(
          " from permit to certificate of occupancy.",
          " do permit ao certificado de ocupação (CO).",
          " del permiso al certificado de ocupación (CO).",
        ),
      ),
    ]),
    bullet(
      tr(
        "Vertically integrated through Truss Direct, the group’s truss manufacturer supplying 90+ projects per month — insulating the program from a key supply-chain bottleneck.",
        "Verticalizada via Truss Direct, a fábrica de treliças do grupo, que abastece 90+ projetos por mês — isolando o programa de um gargalo-chave da cadeia de suprimentos.",
        "Integrada verticalmente a través de Truss Direct, la fábrica de cerchas del grupo, que abastece 90+ proyectos por mes — aislando el programa de un cuello de botella clave de la cadena de suministro.",
      ),
    ),
    bullet(
      tr(
        "BBB accredited; every home delivered with a 2-10 structural warranty and covered by builder’s risk insurance during construction.",
        "Acreditada no BBB; toda casa é entregue com garantia estrutural 2-10 e coberta por seguro builder's risk durante a obra.",
        "Acreditada por el BBB; cada casa se entrega con garantía estructural 2-10 y cubierta por seguro builder's risk durante la obra.",
      ),
    ),
    // Execution at scale (mock aprovado 15/07): n grande de DATAS da planilha TrackRecord
    // — cria a escada 500+ → 304 → 44 e prova a máquina; financials dela são internos
    ...(d.trackRecord.execution && d.trackRecord.execution.trackedProjects > 0
      ? [
          h2(tr("Execution at scale", "Execução em escala", "Ejecución a escala")),
          body([
            t(
              tr(
                "Every project is tracked milestone-by-milestone — permit, foundation, certificate of occupancy, closing — in the Builder's operating system. Across the ",
                "Todo projeto é acompanhado marco a marco — permit, fundação, certificado de ocupação, closing — no sistema operacional da Construtora. Nos ",
                "Cada proyecto se sigue hito por hito — permiso, cimentación, certificado de ocupación, cierre — en el sistema operativo de la Constructora. En los ",
              ),
            ),
            t(
              tr(
                `${d.trackRecord.execution.trackedProjects} projects tracked in the current extraction (${d.trackRecord.execution.periodYears})`,
                `${d.trackRecord.execution.trackedProjects} projetos rastreados na extração atual (${d.trackRecord.execution.periodYears})`,
                `${d.trackRecord.execution.trackedProjects} proyectos rastreados en la extracción actual (${d.trackRecord.execution.periodYears})`,
              ),
              { bold: true },
            ),
            t(":"),
          ]),
          bigStatGrid([
            {
              value: tr(
                `${(d.trackRecord.execution.buildMedianDays / 30).toFixed(1)} mo`,
                `${(d.trackRecord.execution.buildMedianDays / 30).toFixed(1)} m`,
                `${(d.trackRecord.execution.buildMedianDays / 30).toFixed(1)} m`,
              ),
              label: tr(
                `Median build time · n=${d.trackRecord.execution.buildN}`,
                `Obra mediana · n=${d.trackRecord.execution.buildN}`,
                `Obra mediana · n=${d.trackRecord.execution.buildN}`,
              ),
            },
            {
              value: tr(
                `${(d.trackRecord.execution.permitToCoMedianDays / 30).toFixed(1)} mo`,
                `${(d.trackRecord.execution.permitToCoMedianDays / 30).toFixed(1)} m`,
                `${(d.trackRecord.execution.permitToCoMedianDays / 30).toFixed(1)} m`,
              ),
              label: tr(
                `Median permit → CO · n=${d.trackRecord.execution.permitToCoN}`,
                `Permit → CO mediano · n=${d.trackRecord.execution.permitToCoN}`,
                `Permiso → CO mediano · n=${d.trackRecord.execution.permitToCoN}`,
              ),
            },
            {
              value: `≈${Math.round(d.trackRecord.execution.ramp.toCount / Math.max(1, d.trackRecord.execution.ramp.fromCount))}×`,
              label: tr(
                `Delivery ramp · ${d.trackRecord.execution.ramp.fromCount} COs ${d.trackRecord.execution.ramp.fromYear} → ${d.trackRecord.execution.ramp.toCount} in ${d.trackRecord.execution.ramp.toYear}`,
                `Rampa de entrega · ${d.trackRecord.execution.ramp.fromCount} COs ${d.trackRecord.execution.ramp.fromYear} → ${d.trackRecord.execution.ramp.toCount} em ${d.trackRecord.execution.ramp.toYear}`,
                `Rampa de entrega · ${d.trackRecord.execution.ramp.fromCount} COs ${d.trackRecord.execution.ramp.fromYear} → ${d.trackRecord.execution.ramp.toCount} en ${d.trackRecord.execution.ramp.toYear}`,
              ),
            },
            {
              value: String(d.trackRecord.execution.inProductionNow),
              label: tr("Homes in production today", "Casas em produção hoje", "Casas en producción hoy"),
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
          h2(
            tr(
              "Verified investor returns — representative sample",
              "Retornos verificados do investidor — amostra representativa",
              "Retornos verificados del inversor — muestra representativa",
            ),
          ),
          body([
            t(tr("Returns are measured on a ", "Os retornos são medidos sobre uma ", "Los retornos se miden sobre una ")),
            t(
              tr(
                `representative sample of ${d.trackRecord.sample.n} recent closed projects`,
                `amostra representativa de ${d.trackRecord.sample.n} projetos recentes concluídos`,
                `muestra representativa de ${d.trackRecord.sample.n} proyectos recientes concluidos`,
              ),
              { bold: true },
            ),
            t(
              tr(
                `, drawn from the Builder's complete project records: every client project closed in ${d.trackRecord.sample.periodYears} with full milestone and financial detail in the current data extraction. The recent window is the decision-relevant sample — it reflects today's construction costs, pricing and cycle times, the same environment this program is underwritten in. On these projects, the realized net return on total project cost — lot plus construction — was a median of `,
                `, extraída dos registros completos de projetos da Construtora: todos os projetos de clientes concluídos em ${d.trackRecord.sample.periodYears} com marcos e detalhe financeiro completos na extração de dados atual. A janela recente é a amostra relevante para decisão — reflete os custos de obra, preços e ciclos de hoje, o mesmo ambiente em que este programa foi subscrito. Nesses projetos, o retorno líquido realizado sobre o custo total do projeto — lote mais obra — teve mediana de `,
                `, extraída de los registros completos de proyectos de la Constructora: todos los proyectos de clientes concluidos en ${d.trackRecord.sample.periodYears} con hitos y detalle financiero completos en la extracción de datos actual. La ventana reciente es la muestra relevante para decidir — refleja los costos de obra, precios y ciclos de hoy, el mismo entorno en que se suscribió este programa. En esos proyectos, el retorno neto realizado sobre el costo total del proyecto — lote más obra — tuvo una mediana de `,
              ),
            ),
            t(
              tr(
                `${d.trackRecord.roiPerCyclePct.median}% per cycle`,
                `${d.trackRecord.roiPerCyclePct.median}% por ciclo`,
                `${d.trackRecord.roiPerCyclePct.median}% por ciclo`,
              ),
              { bold: true },
            ),
            t(
              tr(
                ` (range ${d.trackRecord.roiPerCyclePct.min}%–${d.trackRecord.roiPerCyclePct.max}%), over a median cycle of ${(d.trackRecord.cycle.medianDays / 30).toFixed(1)} months from contract to sale closing.`,
                ` (faixa ${d.trackRecord.roiPerCyclePct.min}%–${d.trackRecord.roiPerCyclePct.max}%), num ciclo mediano de ${(d.trackRecord.cycle.medianDays / 30).toFixed(1)} meses do contrato ao closing da venda.`,
                ` (rango ${d.trackRecord.roiPerCyclePct.min}%–${d.trackRecord.roiPerCyclePct.max}%), en un ciclo mediano de ${(d.trackRecord.cycle.medianDays / 30).toFixed(1)} meses del contrato al cierre de la venta.`,
              ),
            ),
          ]),
          bigStatGrid([
            {
              value: `${d.trackRecord.roiPerCyclePct.median}%`,
              label: tr("Realized ROI / cycle (median)", "ROI realizado / ciclo (mediana)", "ROI realizado / ciclo (mediana)"),
            },
            {
              value: `${d.trackRecord.estimatedIrrPct.median}%`,
              label: tr("Estimated investor IRR (median)", "TIR estimada do investidor (mediana)", "TIR estimada del inversor (mediana)"),
            },
            {
              value: `${d.trackRecord.conservativeFloorIrrPct.median}%`,
              label: tr("Conservative-floor IRR (median)", "TIR piso conservador (mediana)", "TIR piso conservador (mediana)"),
            },
            {
              value: tr(
                `${(d.trackRecord.cycle.medianDays / 30).toFixed(1)} mo`,
                `${(d.trackRecord.cycle.medianDays / 30).toFixed(1)} m`,
                `${(d.trackRecord.cycle.medianDays / 30).toFixed(1)} m`,
              ),
              label: tr("Median cycle", "Ciclo mediano", "Ciclo mediano"),
            },
          ]),
          new Paragraph({
            spacing: { before: 100, after: 200, line: 252 },
            children: [
              new TextRun({
                text: tr(
                  `Estimated IRR applies the program's actual client payment schedule (${d.trackRecord.paymentPlanPct.join("/")}) to each project's real permit, foundation, completion and closing dates; the conservative floor assumes all capital deployed on day one — under that floor, no project in the sample returned less than ${d.trackRecord.conservativeFloorIrrPct.min}% annualized. These are estimates derived from realized profits and actual dates, not realized IRRs, and prior performance is not indicative of future results.`,
                  `A TIR estimada aplica o cronograma real de pagamento do cliente (${d.trackRecord.paymentPlanPct.join("/")}) às datas reais de permit, fundação, conclusão e closing de cada projeto; o piso conservador assume todo o capital aportado no dia um — mesmo nesse piso, nenhum projeto da amostra retornou menos de ${d.trackRecord.conservativeFloorIrrPct.min}% anualizado. São estimativas derivadas de lucros realizados e datas reais, não TIRs realizadas, e desempenho passado não é indicativo de resultados futuros.`,
                  `La TIR estimada aplica el calendario real de pagos del cliente (${d.trackRecord.paymentPlanPct.join("/")}) a las fechas reales de permiso, cimentación, conclusión y cierre de cada proyecto; el piso conservador asume todo el capital aportado el día uno — aun bajo ese piso, ningún proyecto de la muestra retornó menos de ${d.trackRecord.conservativeFloorIrrPct.min}% anualizado. Son estimaciones derivadas de utilidades realizadas y fechas reales, no TIRs realizadas, y el desempeño pasado no es indicativo de resultados futuros.`,
                ),
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
          h2(tr("The homes in this program", "As casas deste programa", "Las casas de este programa")),
          ...modelCardsBlock(d.modelCards),
          new Paragraph({
            spacing: { before: 60, after: 160 },
            children: [
              new TextRun({
                text: tr(
                  "Model specifications as published by the Builder (4youhomes.com/portfolio); underwriting figures from this program's Expected Case. Per-home economics for each home are detailed in Appendix A.1.",
                  "Especificações dos modelos conforme publicadas pela Construtora (4youhomes.com/portfolio); números de subscrição do Cenário Esperado deste programa. A economia por casa está detalhada no Apêndice A.1.",
                  "Especificaciones de los modelos según lo publicado por la Constructora (4youhomes.com/portfolio); cifras de suscripción del Escenario Esperado de este programa. La economía por casa se detalla en el Apéndice A.1.",
                ),
                font: FONT,
                size: 16,
                color: GRAY,
                italics: true,
              }),
            ],
          }),
        ]
      : []),
    h2(
      isClient
        ? tr("Vixus Investment — the Development Manager", "Vixus Investment — o Development Manager", "Vixus Investment — el Development Manager")
        : tr("Vixus Investment — the Manager", "Vixus Investment — a Gestora", "Vixus Investment — el Administrador"),
    ),
    body(
      isClient
        ? tr(
            "Vixus Investment acts as Development Manager to investor-owned entities: it runs the program — land acquisition within the disclosed basket, construction disbursements against milestones, sales coordination and reporting — under a development management agreement, without custody of the investor entity. The same purpose-built platform tracks every dollar, and the entity's members receive statements generated from the same ledger Vixus uses to run the program.",
            "A Vixus Investment atua como Development Manager de entidades detidas pelos investidores: opera o programa — aquisição de lotes dentro da cesta divulgada, desembolsos de obra contra marcos, coordenação de vendas e relatórios — sob um development management agreement, sem custódia da entidade investidora. A mesma plataforma proprietária rastreia cada dólar, e os sócios da entidade recebem extratos gerados do mesmo ledger que a Vixus usa para operar o programa.",
            "Vixus Investment actúa como Development Manager de entidades propiedad de los inversores: opera el programa — adquisición de lotes dentro de la canasta divulgada, desembolsos de obra contra hitos, coordinación de ventas e informes — bajo un development management agreement, sin custodia de la entidad inversora. La misma plataforma propietaria rastrea cada dólar, y los socios de la entidad reciben estados generados del mismo ledger que Vixus usa para operar el programa.",
          )
        : tr(
            "Vixus Investment administers investor vehicles for the group: capitalization, capital calls, construction-loan reconciliation, tax (K-1) coordination and investor reporting. The Manager operates a purpose-built platform that tracks every dollar from subscription to distribution; investors receive statements generated from the same ledger the Manager uses to run the business.",
            "A Vixus Investment administra os veículos de investimento do grupo: capitalização, chamadas de capital, conciliação de financiamentos de obra, coordenação tributária (K-1) e relatórios aos investidores. A Gestora opera uma plataforma construída sob medida que rastreia cada dólar da subscrição à distribuição; os investidores recebem extratos gerados do mesmo ledger que a Gestora usa para operar o negócio.",
            "Vixus Investment administra los vehículos de inversión del grupo: capitalización, llamadas de capital, conciliación de préstamos de obra, coordinación fiscal (K-1) e informes a inversores. El Administrador opera una plataforma construida a medida que rastrea cada dólar desde la suscripción hasta la distribución; los inversores reciben estados generados del mismo ledger que el Administrador usa para operar el negocio.",
          ),
    ),
    // Diferencial que quase nenhum sponsor pequeno tem — o software (feedback 15/07)
    h2(tr("Technology-driven investment management", "Gestão de investimentos orientada por tecnologia", "Gestión de inversiones impulsada por tecnología")),
    body([
      t(
        tr(
          "Every capital call, construction draw, budget variance and distribution is tracked in the same proprietary platform used to operate the business — investors receive reports generated directly from the operating ledger, not from manually prepared spreadsheets. ",
          "Cada chamada de capital, draw de obra, desvio de orçamento e distribuição é registrado na mesma plataforma proprietária usada para operar o negócio — os investidores recebem relatórios gerados diretamente do ledger operacional, não de planilhas preparadas à mão. ",
          "Cada llamada de capital, desembolso de obra, desviación de presupuesto y distribución se registra en la misma plataforma propietaria usada para operar el negocio — los inversores reciben informes generados directamente del ledger operativo, no de planillas preparadas a mano. ",
        ),
      ),
      t(
        tr(
          "This Summary itself is an output of that platform: ",
          "Este Resumo é, ele próprio, um produto dessa plataforma: ",
          "Este Resumen es, en sí mismo, un producto de esa plataforma: ",
        ),
        { bold: true },
      ),
      t(
        tr(
          "each edition is generated from a live simulation, refreshed against the weekly MLS extract, and blocked from issuance unless its sources and uses reconcile to the cent (Appendix A.4). A traditional sponsor updates a spreadsheet; this program's numbers cannot drift from its books.",
          "cada edição é gerada de uma simulação viva, atualizada contra o extrato semanal do MLS, e bloqueada se as origens e aplicações não conciliarem ao centavo (Apêndice A.4). Um sponsor tradicional atualiza uma planilha; os números deste programa não conseguem se descolar dos livros.",
          "cada edición se genera de una simulación viva, actualizada contra el extracto semanal del MLS, y se bloquea si los orígenes y aplicaciones no concilian al centavo (Apéndice A.4). Un sponsor tradicional actualiza una planilla; los números de este programa no pueden desviarse de sus libros.",
        ),
      ),
    ]),
    h2(tr("Leadership", "Liderança", "Liderazgo")),
    // Formato executivo (feedback 15/07): nome/cargo + "Responsible for" — currículo vira função
    new Table({
      width: { size: W, type: WidthType.DXA },
      columnWidths: [3120, 3120, 3120],
      rows: [
        new TableRow({
          children: [
            {
              name: "Stefan Braga Lemos",
              title: tr("Founder & COO", "Fundador & COO", "Fundador & COO"),
              areas: [
                tr("Operations", "Operações", "Operaciones"),
                tr("Construction", "Obra", "Construcción"),
                tr("Cost control", "Controle de custos", "Control de costos"),
                tr("Investment platform", "Plataforma de investimentos", "Plataforma de inversiones"),
              ],
              bg: tr(
                "Civil engineer; co-owned Avantec Engenharia (Brazil) before founding 4U in 2019.",
                "Engenheiro civil; sócio da Avantec Engenharia (Brasil) antes de fundar a 4U em 2019.",
                "Ingeniero civil; socio de Avantec Engenharia (Brasil) antes de fundar 4U en 2019.",
              ),
            },
            {
              name: "Evair Gallardo",
              title: "CEO",
              areas: [
                tr("Strategy", "Estratégia", "Estrategia"),
                tr("Corporate development", "Desenvolvimento corporativo", "Desarrollo corporativo"),
                tr("Supply chain (Truss Direct)", "Cadeia de suprimentos (Truss Direct)", "Cadena de suministro (Truss Direct)"),
              ],
              bg: tr(
                "Founder and director experience in Brazilian telecom (Kerax); CEO of Truss Direct.",
                "Experiência de fundador e diretor em telecom no Brasil (Kerax); CEO da Truss Direct.",
                "Experiencia como fundador y director en telecom en Brasil (Kerax); CEO de Truss Direct.",
              ),
            },
            {
              name: "Patrick Geaquinto",
              title: tr("Founder & VP of Sales", "Fundador & VP de Vendas", "Fundador & VP de Ventas"),
              areas: [
                tr("Sales & pricing", "Vendas & pricing", "Ventas & pricing"),
                tr("Broker network", "Rede de corretores", "Red de brokers"),
                tr("Market coverage", "Cobertura de mercado", "Cobertura de mercado"),
              ],
              bg: tr(
                "Commercial Director at Avantec Engenharia; previously Orla Construções. Co-founded 4U in 2019.",
                "Diretor Comercial da Avantec Engenharia; antes, Orla Construções. Cofundou a 4U em 2019.",
                "Director Comercial de Avantec Engenharia; antes, Orla Construções. Cofundó 4U en 2019.",
              ),
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
                    children: [
                      t(tr("Responsible for:", "Responsável por:", "Responsable de:"), { size: 16, italics: true, color: GRAY }),
                    ],
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
            t(
              tr(
                "Alignment of interests: the Builder’s compensation is ",
                "Alinhamento de interesses: a remuneração da Construtora é ",
                "Alineación de intereses: la compensación de la Constructora está ",
              ),
            ),
            t(
              tr("subordinated to project performance", "subordinada à performance do projeto", "subordinada al desempeño del proyecto"),
              { bold: true },
            ),
            t(
              tr(
                " — under this model, 4U earns only a share of realized net profit. There is no development fee payable regardless of outcome.",
                " — neste modelo, a 4U ganha apenas uma fração do lucro líquido realizado. Não há taxa devida independentemente do resultado.",
                " — bajo este modelo, 4U gana solo una fracción de la utilidad neta realizada. No hay tarifa pagadera con independencia del resultado.",
              ),
            ),
          ]),
        ]
      : d.compMode === "OPEN_BOOK"
        ? [
            body([
              t(
                tr(
                  "Alignment of interests: construction is delivered on an ",
                  "Alinhamento de interesses: a obra é entregue em regime ",
                  "Alineación de intereses: la obra se entrega en régimen de ",
                ),
              ),
              t(tr("open-book basis", "open book", "libro abierto"), { bold: true }),
              t(
                tr(
                  ` — the Builder bills documented construction cost plus a fixed, fully disclosed fee of ${money0(d.flatFeePerHouse)} per home. The Builder’s margin is transparent and capped per home, every cost is auditable against invoices on the Manager’s platform`,
                  ` — a Construtora fatura o custo documentado da obra mais uma taxa fixa e integralmente divulgada de ${money0(d.flatFeePerHouse)} por casa. A margem da Construtora é transparente e limitada por casa, todo custo é auditável contra notas na plataforma da Gestora`,
                  ` — la Constructora factura el costo documentado de la obra más una tarifa fija y totalmente divulgada de ${money0(d.flatFeePerHouse)} por casa. El margen de la Constructora es transparente y limitado por casa, cada costo es auditable contra facturas en la plataforma del Administrador`,
                ) +
                  (d.hasPromote
                    ? tr(
                        ", and any additional performance share accrues only above investor return hurdles (see Section 7).",
                        ", e qualquer participação adicional por performance só é devida acima dos hurdles de retorno do investidor (ver Seção 7).",
                        ", y cualquier participación adicional por desempeño solo se devenga por encima de los umbrales de retorno del inversor (ver Sección 7).",
                      )
                    : tr(
                        ", and cost overruns compress the Builder’s effective economics — not the investor’s protections.",
                        ", e estouros de custo comprimem a economia efetiva da Construtora — não as proteções do investidor.",
                        ", y los sobrecostos comprimen la economía efectiva de la Constructora — no las protecciones del inversor.",
                      )),
              ),
            ]),
          ]
        : [
            body([
              t(
                tr(
                  "Alignment of interests: the Builder works under a ",
                  "Alinhamento de interesses: a Construtora trabalha sob ",
                  "Alineación de intereses: la Constructora trabaja bajo una ",
                ),
              ),
              t(tr("fixed contractor fee", "contractor fee fixo", "tarifa fija de contratista"), { bold: true }),
              t(
                tr(
                  " embedded in the construction contract — the Builder’s compensation is capped per home and fully reflected in the per-home economics of Appendix A; construction cost risk within the contract is borne by the Builder, not the investors.",
                  " embutido no contrato de obra — a remuneração da Construtora é limitada por casa e integralmente refletida na economia por casa do Apêndice A; o risco de custo de obra dentro do contrato é da Construtora, não dos investidores.",
                  " incluida en el contrato de obra — la compensación de la Constructora está limitada por casa y totalmente reflejada en la economía por casa del Apéndice A; el riesgo de costo de obra dentro del contrato lo asume la Constructora, no los inversores.",
                ),
              ),
            ]),
          ]),

    // ── 3. MARKET ──
    h1(tr("3. Market Opportunity", "3. Oportunidade de Mercado", "3. Oportunidad de Mercado")),
    body([
      t(
        tr(
          `The program builds entry-level and mid-range single-family homes in Florida submarkets selected for permit velocity, lot availability and sustained absorption. Statistics are derived from a weekly ATTOM MLS feed (extract of ${d.market.extractDate}; ${d.market.totalListings.toLocaleString("en-US")} listings across ${d.market.counties.join(", ")} counties; sold figures reflect the trailing ${d.market.windowDays} days) and refresh with every edition of this Summary.`,
          `O programa constrói casas unifamiliares de entrada e padrão médio em submercados da Flórida selecionados por velocidade de permit, disponibilidade de lotes e absorção sustentada. As estatísticas vêm de um feed semanal ATTOM MLS (extrato de ${d.market.extractDate}; ${d.market.totalListings.toLocaleString("en-US")} anúncios nos condados de ${d.market.counties.join(", ")}; vendidos refletem os últimos ${d.market.windowDays} dias) e são atualizadas a cada edição deste Resumo.`,
          `El programa construye casas unifamiliares de nivel de entrada y rango medio en submercados de Florida seleccionados por velocidad de permisos, disponibilidad de lotes y absorción sostenida. Las estadísticas provienen de un feed semanal ATTOM MLS (extracto de ${d.market.extractDate}; ${d.market.totalListings.toLocaleString("en-US")} anuncios en los condados de ${d.market.counties.join(", ")}; los vendidos reflejan los últimos ${d.market.windowDays} días) y se actualizan con cada edición de este Resumen.`,
        ),
      ),
    ]),
    gridTable(
      [
        tr("Submarket", "Submercado", "Submercado"),
        tr("Median sale $/SF", "$/SF venda (mediana)", "$/SF venta (mediana)"),
        tr("New-constr. $/SF", "$/SF casa nova", "$/SF obra nueva"),
        tr("Median DOM", "DOM mediano", "DOM mediano"),
        tr(`Sold (${d.market.windowDays}d)`, `Vendidas (${d.market.windowDays}d)`, `Vendidas (${d.market.windowDays}d)`),
        tr("New-constr. share", "% casa nova", "% obra nueva"),
      ],
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
          h2(tr("Underwriting vs. observed market", "Premissas × mercado observado", "Supuestos × mercado observado")),
          body(
            tr(
              "Each underwriting assumption below is positioned against closed transactions in its submarket: lot costs against sold lots, sale prices against sold new-construction homes ($/SF where floor-plan areas are on file). The Expected Case prices relative to these observed medians; the Stress Case applies an additional discount on top.",
              "Cada premissa de subscrição abaixo é posicionada contra transações fechadas no seu submercado: custos de lote contra lotes vendidos, preços de venda contra casas novas vendidas ($/SF quando a metragem da planta está cadastrada). O Cenário Esperado precifica relativo a essas medianas observadas; o Cenário de Estresse aplica um desconto adicional por cima.",
              "Cada supuesto de suscripción a continuación se posiciona contra transacciones cerradas en su submercado: costos de lote contra lotes vendidos, precios de venta contra casas nuevas vendidas ($/SF cuando el área de la planta está registrada). El Escenario Esperado fija precios relativos a esas medianas observadas; el Escenario de Estrés aplica un descuento adicional encima.",
            ),
          ),
          gridTable(
            [
              tr("Assumption", "Premissa", "Supuesto"),
              tr("Program", "Programa", "Programa"),
              tr("Market median (sold)", "Mediana do mercado (vendidos)", "Mediana del mercado (vendidos)"),
              tr("Percentile", "Percentil", "Percentil"),
            ],
            d.benchmark
              .filter((b) => b.verdict !== "NO_DATA")
              .map((b) => [
                `${b.kind === "lot" ? tr("Lot cost", "Custo do lote", "Costo del lote") : tr("Sale price", "Preço de venda", "Precio de venta")} — ${b.label.replace("@", "·")}`,
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
            tr(
              "Program pricing is underwritten against these observed comparables: the Expected Case prices relative to the prevailing new-construction medians in each submarket, and the Stress Case applies an additional discount on top.",
              "A precificação do programa é subscrita contra esses comparáveis observados: o Cenário Esperado precifica relativo às medianas vigentes de casas novas em cada submercado, e o Cenário de Estresse aplica um desconto adicional por cima.",
              "Los precios del programa se suscriben contra estos comparables observados: el Escenario Esperado fija precios relativos a las medianas vigentes de obra nueva en cada submercado, y el Escenario de Estrés aplica un descuento adicional encima.",
            ),
          ),
        ]),
    ...(prose?.marketCommentary?.length
      ? [
          h2(tr("Market commentary", "Comentário de mercado", "Comentario de mercado")),
          ...prose.marketCommentary.map((p) => body(p)),
          aiNote(d, prose),
        ]
      : []),

    // ── 4. STRATEGY — prosa acompanha a estrutura REAL (feedback do advogado 14/07:
    // descrever a esteira num projeto de ciclo único contradizia o §6) ──
    h1(
      d.cycles.length > 1
        ? tr("4. Investment Strategy — the Pipeline", "4. Estratégia de Investimento — a Esteira", "4. Estrategia de Inversión — el Pipeline")
        : tr("4. Investment Strategy", "4. Estratégia de Investimento", "4. Estrategia de Inversión"),
    ),
    ...(d.cycles.length > 1
      ? [
          body(
            tr(
              "The program’s core mechanic is disciplined capital recycling. Homes are organized in chained cycles: while the first basket of homes is under construction, lots for the following cycle are acquired and permit applications are filed in advance, so that each closed sale immediately triggers the start of the next home (“sell one, start one”). The initial raise is sized to fund the first cycle in full plus the land and permit-application costs of the second; from the third cycle onward, expansion is funded primarily by recycled sale proceeds.",
              "A mecânica central do programa é a reciclagem disciplinada de capital. As casas são organizadas em ciclos encadeados: enquanto a primeira cesta está em obra, os lotes do ciclo seguinte são adquiridos e os pedidos de permit protocolados com antecedência, de modo que cada venda fechada dispara imediatamente o início da próxima casa (“vendeu uma, começa uma”). A captação inicial é dimensionada para financiar o primeiro ciclo por inteiro mais os lotes e custos de protocolo do segundo; do terceiro ciclo em diante, a expansão é financiada principalmente pelos recursos reciclados das vendas.",
              "La mecánica central del programa es el reciclaje disciplinado de capital. Las casas se organizan en ciclos encadenados: mientras la primera canasta está en obra, los lotes del ciclo siguiente se adquieren y las solicitudes de permiso se presentan por adelantado, de modo que cada venta cerrada dispara de inmediato el inicio de la siguiente casa (“vendida una, empieza una”). La captación inicial se dimensiona para financiar el primer ciclo completo más los lotes y costos de solicitud del segundo; del tercer ciclo en adelante, la expansión se financia principalmente con los recursos reciclados de las ventas.",
            ),
          ),
          bullet(
            tr(
              "Permit discipline: permit costs are always funded by equity — construction lenders do not fund permits. Pre-permitting is what allows a new home to break ground the day after its triggering sale closes.",
              "Disciplina de permit: custos de permit são sempre pagos com equity — bancos de obra não financiam permits. O pré-licenciamento é o que permite que uma casa nova saia do chão no dia seguinte ao closing da venda que a disparou.",
              "Disciplina de permisos: los costos de permisos siempre se pagan con capital propio — los bancos de obra no financian permisos. El pre-permisado es lo que permite que una casa nueva arranque al día siguiente del cierre de la venta que la disparó.",
            ),
          ),
          ...(savingPct != null && savingPct > 0
            ? [
                bullet([
                  t(
                    tr(
                      "Capital efficiency: the Pipeline delivers the program’s ",
                      "Eficiência de capital: a Esteira entrega as ",
                      "Eficiencia de capital: el Pipeline entrega las ",
                    ),
                  ),
                  t(tr(`${nHomes} homes`, `${nHomes} casas do programa`, `${nHomes} casas del programa`), { bold: true }),
                  t(tr(" with approximately ", " com aproximadamente ", " con aproximadamente ")),
                  t(
                    tr(`${savingPct}% less peak capital`, `${savingPct}% menos pico de capital`, `${savingPct}% menos pico de capital`),
                    { bold: true },
                  ),
                  t(
                    tr(
                      ` than building all homes simultaneously (${money0(expected.peakCapital)} vs. ${money0(d.singleShotPeak!)}) — the same aggregate profit on materially less equity at risk, which is what drives the projected IRR.`,
                      ` do que construir todas as casas simultaneamente (${money0(expected.peakCapital)} vs. ${money0(d.singleShotPeak!)}) — o mesmo lucro agregado com materialmente menos capital em risco, que é o que impulsiona a TIR projetada.`,
                      ` que construir todas las casas simultáneamente (${money0(expected.peakCapital)} vs. ${money0(d.singleShotPeak!)}) — la misma utilidad agregada con materialmente menos capital en riesgo, que es lo que impulsa la TIR proyectada.`,
                    ),
                  ),
                ]),
              ]
            : []),
          bullet(
            tr(
              "Just-in-time treasury: investor capital is called only when project cash cannot cover the next obligation, and surplus cash is returned as soon as the forward schedule no longer requires it.",
              "Tesouraria just-in-time: o capital do investidor só é chamado quando o caixa do projeto não cobre a próxima obrigação, e o excedente é devolvido assim que o cronograma futuro deixa de exigi-lo.",
              "Tesorería just-in-time: el capital del inversor solo se llama cuando la caja del proyecto no cubre la siguiente obligación, y el excedente se devuelve en cuanto el cronograma futuro deja de requerirlo.",
            ),
          ),
          bullet([
            t(tr("Cycle structure for this Project: ", "Estrutura de ciclos deste Projeto: ", "Estructura de ciclos de este Proyecto: ")),
            t(cyclesText, { bold: true }),
            t("."),
          ]),
        ]
      : [
          body(
            tr(
              `The program builds its ${nHomes} homes in a single construction wave with staggered starts, so that lot acquisition, permitting and construction advance as a coordinated schedule rather than all at once. Homes are sold individually upon completion, and investor capital is returned as each sale closes — the timeline in Section 5 shows the resulting phase windows.`,
              `O programa constrói suas ${nHomes} casas em uma única onda de obra com inícios escalonados, de modo que aquisição de lotes, permits e obra avancem como um cronograma coordenado, e não tudo de uma vez. As casas são vendidas individualmente na conclusão, e o capital do investidor retorna a cada closing — a linha do tempo da Seção 5 mostra as janelas de fase resultantes.`,
              `El programa construye sus ${nHomes} casas en una sola ola de obra con inicios escalonados, de modo que la adquisición de lotes, los permisos y la obra avancen como un cronograma coordinado, y no todo a la vez. Las casas se venden individualmente al concluirse, y el capital del inversor retorna con cada cierre — la línea de tiempo de la Sección 5 muestra las ventanas de fase resultantes.`,
            ),
          ),
          bullet(
            tr(
              "Permit discipline: permit costs are always funded by equity — construction lenders do not fund permits. Construction begins only after the lot is owned and the permit is issued.",
              "Disciplina de permit: custos de permit são sempre pagos com equity — bancos de obra não financiam permits. A obra só começa depois que o lote é próprio e o permit está emitido.",
              "Disciplina de permisos: los costos de permisos siempre se pagan con capital propio — los bancos de obra no financian permisos. La obra solo comienza después de que el lote es propio y el permiso está emitido.",
            ),
          ),
          bullet(
            tr(
              "Just-in-time treasury: investor capital is called only when project cash cannot cover the next obligation, and surplus cash is returned as soon as the forward schedule no longer requires it — capital is never idle by design.",
              "Tesouraria just-in-time: o capital do investidor só é chamado quando o caixa do projeto não cobre a próxima obrigação, e o excedente é devolvido assim que o cronograma futuro deixa de exigi-lo — por desenho, capital nunca fica parado.",
              "Tesorería just-in-time: el capital del inversor solo se llama cuando la caja del proyecto no cubre la siguiente obligación, y el excedente se devuelve en cuanto el cronograma futuro deja de requerirlo — por diseño, el capital nunca queda ocioso.",
            ),
          ),
          bullet(
            tr(
              "The same engine supports multi-cycle programs (“sell one, start one”), where sale proceeds trigger the next home; this Project is underwritten as a single cycle.",
              "O mesmo motor suporta programas multiciclo (“vendeu uma, começa uma”), em que o dinheiro da venda dispara a próxima casa; este Projeto foi subscrito como ciclo único.",
              "El mismo motor soporta programas multiciclo (“vendida una, empieza una”), donde el producto de la venta dispara la siguiente casa; este Proyecto se suscribió como ciclo único.",
            ),
          ),
        ]),

    // ── 5. FINANCING ──
    h1(tr("5. Construction Financing Discipline", "5. Disciplina do Financiamento de Obra", "5. Disciplina del Financiamiento de Obra")),
    ...(isBank
      ? [
          body([
            t(
              tr(
                `Construction facilities are sized per home at the lesser of ${d.bankTerms?.ltcBuildPct ?? "—"}% of cost basis (construction contract plus lot) and ${d.bankTerms?.ltvPct ?? "—"}% of appraised completed value, rounded down to the nearest $5,000. Interest accrues on the drawn balance only. Lender terms — origination, broker, title, inspection and reconveyance fees, interest-reserve mechanics and release provisions — are modeled line-by-line from executed term sheets rather than approximated.`,
                `As linhas de obra são dimensionadas por casa pelo menor entre ${d.bankTerms?.ltcBuildPct ?? "—"}% da base de custo (contrato de obra mais lote) e ${d.bankTerms?.ltvPct ?? "—"}% do valor de avaliação concluído, arredondado para baixo em múltiplos de $5.000. Os juros incidem apenas sobre o saldo sacado. Os termos do banco — origination, broker, title, inspeção, reconveyance, mecânica de interest reserve e provisões de liberação — são modelados linha a linha a partir de term sheets assinados, não aproximados.`,
                `Las líneas de obra se dimensionan por casa por el menor entre ${d.bankTerms?.ltcBuildPct ?? "—"}% de la base de costo (contrato de obra más lote) y ${d.bankTerms?.ltvPct ?? "—"}% del valor tasado terminado, redondeado hacia abajo en múltiplos de $5,000. Los intereses se devengan solo sobre el saldo dispuesto. Los términos del banco — origination, broker, title, inspección, reconveyance, mecánica del interest reserve y provisiones de liberación — se modelan línea por línea a partir de term sheets firmados, no aproximados.`,
              ),
            ),
          ]),
          body([
            t(
              tr(
                "The Manager’s model has been benchmarked against the full bank statement of a completed facility: all fees reproduced exactly and interest accruals within a fraction of one percent of the lender’s own figures. For this Project, the modeled facility is ",
                "O modelo da Gestora foi validado contra o extrato bancário completo de uma linha concluída: todas as taxas reproduzidas exatamente e juros com desvio de fração de um por cento dos números do próprio banco. Para este Projeto, a linha modelada é ",
                "El modelo del Administrador fue validado contra el estado bancario completo de una línea concluida: todas las comisiones reproducidas exactamente e intereses con desvío de una fracción del uno por ciento de las cifras del propio banco. Para este Proyecto, la línea modelada es ",
              ),
            ),
            t(`${d.bankName}`, { bold: true }),
            t(
              tr(
                ` (${d.bankTerms?.aprEffectivePct.toFixed(2)}% effective APR, ${d.bankTerms?.termMonths}-month term); its full cost — ${money0(d.closing.bankCost)} across closing fees, interest and per-draw charges — is carried in every figure of Section 6.`,
                ` (${d.bankTerms?.aprEffectivePct.toFixed(2)}% de APR efetivo, prazo de ${d.bankTerms?.termMonths} meses); seu custo integral — ${money0(d.closing.bankCost)} entre taxas de closing, juros e tarifas por draw — está embutido em todos os números da Seção 6.`,
                ` (${d.bankTerms?.aprEffectivePct.toFixed(2)}% de APR efectiva, plazo de ${d.bankTerms?.termMonths} meses); su costo total — ${money0(d.closing.bankCost)} entre comisiones de cierre, intereses y cargos por desembolso — está incluido en todas las cifras de la Sección 6.`,
              ),
            ),
          ]),
        ]
      : [
          body(
            tr(
              "This program is structured all-equity: no construction debt is used, eliminating lender fees, interest-rate exposure and maturity risk. Where the Manager runs leveraged variants of a program, facilities are modeled line-by-line from executed term sheets, and the model has been benchmarked against the full bank statement of a completed facility — fees reproduced exactly and interest accruals within a fraction of one percent.",
              "Este programa é estruturado 100% equity: nenhuma dívida de obra é usada, eliminando taxas de banco, exposição a juros e risco de vencimento. Quando a Gestora roda variantes alavancadas de um programa, as linhas são modeladas linha a linha a partir de term sheets assinados, e o modelo foi validado contra o extrato bancário completo de uma linha concluída — taxas reproduzidas exatamente e juros com desvio de fração de um por cento.",
              "Este programa está estructurado 100% con capital propio: no se usa deuda de obra, eliminando comisiones bancarias, exposición a tasas y riesgo de vencimiento. Cuando el Administrador ejecuta variantes apalancadas de un programa, las líneas se modelan línea por línea a partir de term sheets firmados, y el modelo fue validado contra el estado bancario completo de una línea concluida — comisiones reproducidas exactamente e intereses con desvío de una fracción del uno por ciento.",
            ),
          ),
        ]),

    // Fases do projeto + janela do loan (aprovado no mock 13/07): responde "o loan não
    // fica aberto o projeto inteiro" com números — argumento de venda p/ investidor
    h2(
      d.projectPhases.loan
        ? tr("Program timeline & loan exposure", "Linha do tempo do programa e exposição ao loan", "Línea de tiempo del programa y exposición al préstamo")
        : tr("Program timeline", "Linha do tempo do programa", "Línea de tiempo del programa"),
    ),
    body(
      tr(
        "Phase windows run from the first to the last home in the basket and overlap by design — capital recycling means lots are acquired and homes are sold while others are still under construction. Where the active time is shorter than the span, the phase runs in per-cycle waves: lots and permits are procured in batches, just ahead of need.",
        "As janelas de fase vão da primeira à última casa da cesta e se sobrepõem por desenho — reciclagem de capital significa comprar lotes e vender casas enquanto outras ainda estão em obra. Quando o tempo ativo é menor que a janela, a fase corre em rajadas por ciclo: lotes e permits são providenciados em lotes, pouco antes da necessidade.",
        "Las ventanas de fase van de la primera a la última casa de la canasta y se superponen por diseño — reciclar capital significa comprar lotes y vender casas mientras otras siguen en obra. Cuando el tiempo activo es menor que la ventana, la fase corre en oleadas por ciclo: lotes y permisos se gestionan por tandas, justo antes de necesitarse.",
      ),
    ),
    gridTable(
      [
        tr("Phase", "Fase", "Fase"),
        tr("Window", "Janela", "Ventana"),
        tr("Span", "Extensão", "Extensión"),
        tr("Active", "Ativo", "Activo"),
      ],
      [
        ...(() => {
          const NAMES: Record<string, string> = {
            lots: tr("Lot acquisition", "Aquisição de lotes", "Adquisición de lotes"),
            permits: tr("Permitting", "Licenciamento (permits)", "Permisos"),
            build: tr("Construction", "Obra", "Construcción"),
            sales: tr("Sales & closings", "Vendas e closings", "Ventas y cierres"),
          };
          // Active < Span = fases em rajadas por ciclo (esteira) — honestidade do desenho
          return d.projectPhases.phases.map((p) => [
            NAMES[p.key] ?? p.label,
            `M${daysToMonths(p.from)} – M${daysToMonths(p.to)}`,
            tr(`${daysToMonths(p.to - p.from).toFixed(1)} mo`, `${daysToMonths(p.to - p.from).toFixed(1)} m`, `${daysToMonths(p.to - p.from).toFixed(1)} m`),
            tr(`${daysToMonths(p.activeDays).toFixed(1)} mo`, `${daysToMonths(p.activeDays).toFixed(1)} m`, `${daysToMonths(p.activeDays).toFixed(1)} m`),
          ]);
        })(),
        ...(d.projectPhases.loan
          ? [
              [
                tr("Construction facility outstanding", "Linha de obra em aberto", "Línea de obra vigente"),
                `M${daysToMonths(d.projectPhases.loan.from)} – M${daysToMonths(d.projectPhases.loan.to)}`,
                tr(
                  `${daysToMonths(d.projectPhases.loan.to - d.projectPhases.loan.from).toFixed(1)} mo`,
                  `${daysToMonths(d.projectPhases.loan.to - d.projectPhases.loan.from).toFixed(1)} m`,
                  `${daysToMonths(d.projectPhases.loan.to - d.projectPhases.loan.from).toFixed(1)} m`,
                ),
                tr(
                  `${daysToMonths(d.projectPhases.loan.activeDays).toFixed(1)} of ${daysToMonths(d.projectPhases.totalDays).toFixed(1)} mo`,
                  `${daysToMonths(d.projectPhases.loan.activeDays).toFixed(1)} de ${daysToMonths(d.projectPhases.totalDays).toFixed(1)} m`,
                  `${daysToMonths(d.projectPhases.loan.activeDays).toFixed(1)} de ${daysToMonths(d.projectPhases.totalDays).toFixed(1)} m`,
                ),
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
          text: tr(
            "Each column is one program month; shaded blocks are the months in which the phase is actually active — white gaps within a phase reflect the per-cycle batching described above.",
            "Cada coluna é um mês do programa; blocos pintados são os meses em que a fase está de fato ativa — vazios em branco dentro de uma fase refletem as rajadas por ciclo descritas acima.",
            "Cada columna es un mes del programa; los bloques sombreados son los meses en que la fase está realmente activa — los espacios en blanco dentro de una fase reflejan las oleadas por ciclo descritas arriba.",
          ),
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
              tr(
                `The construction facility is outstanding for ${daysToMonths(d.projectPhases.loan.activeDays).toFixed(1)} of the program's ${daysToMonths(d.projectPhases.totalDays).toFixed(1)} months — interest accrues on drawn balances only`,
                `A linha de obra fica em aberto por ${daysToMonths(d.projectPhases.loan.activeDays).toFixed(1)} dos ${daysToMonths(d.projectPhases.totalDays).toFixed(1)} meses do programa — juros incidem apenas sobre o saldo sacado`,
                `La línea de obra permanece vigente por ${daysToMonths(d.projectPhases.loan.activeDays).toFixed(1)} de los ${daysToMonths(d.projectPhases.totalDays).toFixed(1)} meses del programa — los intereses se devengan solo sobre el saldo dispuesto`,
              ) +
                (d.projectPhases.loan.termDays != null
                  ? d.projectPhases.loan.overrunDays > 0
                    ? tr(
                        `; the Expected Case exceeds the facility's ${Math.round(d.projectPhases.loan.termDays / 30)}-month term by ${daysToMonths(d.projectPhases.loan.overrunDays).toFixed(1)} months, and the corresponding extension fee is carried in every figure of Section 6.`,
                        `; o Cenário Esperado excede o prazo de ${Math.round(d.projectPhases.loan.termDays / 30)} meses da linha em ${daysToMonths(d.projectPhases.loan.overrunDays).toFixed(1)} meses, e a extension fee correspondente está embutida em todos os números da Seção 6.`,
                        `; el Escenario Esperado excede el plazo de ${Math.round(d.projectPhases.loan.termDays / 30)} meses de la línea en ${daysToMonths(d.projectPhases.loan.overrunDays).toFixed(1)} meses, y la extension fee correspondiente está incluida en todas las cifras de la Sección 6.`,
                      )
                    : tr(
                        `, within the facility's ${Math.round(d.projectPhases.loan.termDays / 30)}-month term (no extension fees in the Expected Case).`,
                        `, dentro do prazo de ${Math.round(d.projectPhases.loan.termDays / 30)} meses da linha (sem extension fees no Cenário Esperado).`,
                        `, dentro del plazo de ${Math.round(d.projectPhases.loan.termDays / 30)} meses de la línea (sin extension fees en el Escenario Esperado).`,
                      )
                  : "."),
            ),
          ]),
        ]
      : []),

    // ── 6. PROJECTIONS — narrativa Expected/Stress/Upside (aprovada 15/07): o Expected
    // é o caso-base declarado (defendido pelo benchmark do §3); o Stress dimensiona a
    // captação; a coluna Expected vem primeiro e em negrito ──
    h1(tr("6. Financial Projections", "6. Projeções Financeiras", "6. Proyecciones Financieras")),
    body([
      t(tr("Three scenarios are presented below. The ", "Três cenários são apresentados abaixo. O ", "A continuación se presentan tres escenarios. El ")),
      t(SCEN.REAL, { bold: true }),
      t(
        tr(
          " is the base operating case — its assumptions are benchmarked against closed transactions in Section 3 and the Builder's delivery history (Section 2). The ",
          " é o caso-base operacional — suas premissas são comparadas com transações fechadas na Seção 3 e com o histórico de entregas da Construtora (Seção 2). O ",
          " es el caso base operativo — sus supuestos se comparan con transacciones cerradas en la Sección 3 y con el historial de entregas de la Constructora (Sección 2). El ",
        ),
      ),
      t(SCEN.CONS, { bold: true }),
      t(
        tr(
          " exists to answer one question: what happens if sale prices fall, costs overrun and timelines extend, all at once",
          " existe para responder a uma pergunta: o que acontece se os preços caírem, os custos estourarem e os prazos se estenderem, tudo ao mesmo tempo",
          " existe para responder una pregunta: qué pasa si los precios caen, los costos se exceden y los plazos se extienden, todo a la vez",
        ) +
          (stressSized
            ? tr(
                " — and it is the case used to size the raise",
                " — e é o cenário usado para dimensionar a captação",
                " — y es el escenario usado para dimensionar la captación",
              )
            : "") +
          tr(
            ". All figures are net of builder compensation and project-level costs, and before investor-level taxes.",
            ". Todos os números são líquidos da remuneração da construtora e dos custos do projeto, e antes dos tributos do investidor.",
            ". Todas las cifras son netas de la compensación de la constructora y de los costos del proyecto, y antes de impuestos del inversor.",
          ),
      ),
    ]),
    gridTable(
      [tr("Scenario", "Cenário", "Escenario"), ...ordered.map((s) => scenarioName(s))],
      [
        // papel declarado de cada coluna — elimina a dúvida "qual devo acreditar?"
        [
          tr("Role", "Papel", "Rol"),
          ...ordered.map((s) =>
            t(
              s === expected
                ? tr("most likely outcome", "desfecho mais provável", "desenlace más probable")
                : s === stress
                  ? stressSized
                    ? tr("capital protection · sizes the raise", "proteção de capital · dimensiona a captação", "protección de capital · dimensiona la captación")
                    : tr("capital protection", "proteção de capital", "protección de capital")
                  : s === upside
                    ? tr("strong market & execution", "mercado forte + execução", "mercado fuerte + ejecución")
                    : tr("additional scenario", "cenário adicional", "escenario adicional"),
              { size: 17, italics: true, color: GRAY },
            ),
          ),
        ],
        // "o Expected realmente é o cenário central" — sem %, só a hierarquia (feedback 15/07)
        [
          tr("Probability", "Probabilidade", "Probabilidad"),
          ...ordered.map((s) =>
            t(s === expected ? tr("highest", "mais alta", "más alta") : tr("low", "baixa", "baja"), {
              size: 17,
              italics: true,
              color: GRAY,
            }),
          ),
        ],
        [tr("Projected net IRR", "TIR líquida projetada", "TIR neta proyectada"), ...ordered.map((s, i) => t(pct(s.irrAnnual), { size: 19, bold: i === 0 }))],
        [
          tr("Equity multiple", "Múltiplo de capital", "Múltiplo de capital"),
          ...ordered.map((s, i) =>
            t(s.equityMultiple == null ? "—" : `${s.equityMultiple.toFixed(2)}x`, { size: 19, bold: i === 0 }),
          ),
        ],
        // ROI sobre o PICO — o que conversa com o tamanho da captação (aprovado 14/07)
        [
          tr("Return on peak capital", "Retorno sobre o pico de capital", "Retorno sobre el pico de capital"),
          ...ordered.map((s, i) =>
            t(s.peakCapital > 0 ? pct(s.profit / s.peakCapital) : "—", { size: 19, bold: i === 0 }),
          ),
        ],
        [
          tr("Peak invested capital", "Pico de capital investido", "Pico de capital invertido"),
          ...ordered.map((s, i) => t(money0(s.peakCapital), { size: 19, bold: i === 0 })),
        ],
        [
          tr("Total investor profit", "Lucro total do investidor", "Utilidad total del inversor"),
          ...ordered.map((s, i) => t(money0(s.profit), { size: 19, bold: i === 0 })),
        ],
        [
          tr("Program duration (months)", "Duração do programa (meses)", "Duración del programa (meses)"),
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
            tr(
              "Why is the raise larger than the Expected Case capital requirement?",
              "Por que a captação é maior que o capital exigido no Cenário Esperado?",
              "¿Por qué la captación es mayor que el capital requerido en el Escenario Esperado?",
            ),
            tr(
              `The offering is intentionally sized using the Stress Case peak of ${money0(stress.peakCapital)} rather than the Expected Case peak of ${money0(expected.peakCapital)}. This ensures sufficient capital remains available if costs increase, timelines extend or sale prices soften — capital calls are just-in-time, so capital not required under actual conditions is simply never called or is returned earlier.`,
              `A oferta é intencionalmente dimensionada pelo pico do Cenário de Estresse, de ${money0(stress.peakCapital)}, e não pelo pico do Cenário Esperado, de ${money0(expected.peakCapital)}. Isso garante capital suficiente disponível se custos subirem, prazos se estenderem ou preços cederem — as chamadas de capital são just-in-time, então o capital que as condições reais não exigirem simplesmente nunca é chamado, ou volta mais cedo.`,
              `La oferta se dimensiona intencionalmente por el pico del Escenario de Estrés, de ${money0(stress.peakCapital)}, y no por el pico del Escenario Esperado, de ${money0(expected.peakCapital)}. Esto garantiza capital suficiente disponible si los costos suben, los plazos se extienden o los precios ceden — las llamadas de capital son just-in-time, así que el capital que las condiciones reales no requieran simplemente nunca se llama, o se devuelve antes.`,
            ),
          ),
          body(""),
        ]
      : []),
    h2(tr("Sources & Uses — Expected Case", "Origens e Aplicações — Cenário Esperado", "Orígenes y Aplicaciones — Escenario Esperado")),
    gridTable(
      [
        tr("Uses", "Aplicações", "Aplicaciones"),
        tr("Amount", "Valor", "Monto"),
        tr("Sources", "Origens", "Orígenes"),
        tr("Amount", "Valor", "Monto"),
      ],
      [
        [
          tr("Land acquisition", "Aquisição de lotes", "Adquisición de lotes"),
          money0(d.closing.lots),
          tr("Investor equity (peak)", "Capital do investidor (pico)", "Capital del inversor (pico)"),
          money0(expected.peakCapital),
        ],
        [
          tr("Vertical construction", "Obra vertical", "Construcción vertical"),
          money0(d.closing.construction),
          isBank
            ? tr("Construction facility (committed)", "Linha de obra (contratada)", "Línea de obra (comprometida)")
            : tr("Recycled sale proceeds", "Recursos reciclados das vendas", "Recursos reciclados de ventas"),
          isBank ? money0(d.base.kpis.bankCommitted) : money0(d.closing.sales - expected.peakCapital),
        ],
        [
          tr("Financing costs (all-in)", "Custos de financiamento (all-in)", "Costos de financiamiento (all-in)"),
          money0(d.closing.bankCost),
          isBank ? tr("Recycled sale proceeds", "Recursos reciclados das vendas", "Recursos reciclados de ventas") : "",
          isBank ? money0(d.closing.sales) : "",
        ],
        [
          tr("Builder compensation", "Remuneração da construtora", "Compensación de la constructora"),
          d.closing.builderComp > 0
            ? money0(d.closing.builderComp)
            : d.closing.contractorFeeTotal > 0
              ? tr(
                  `incl. in construction (${money0(d.closing.contractorFeeTotal)})`,
                  `incl. na obra (${money0(d.closing.contractorFeeTotal)})`,
                  `incl. en la obra (${money0(d.closing.contractorFeeTotal)})`,
                )
              : "$0",
          "",
          "",
        ],
        [tr("Net sale proceeds (total)", "Receita líquida de vendas (total)", "Ingresos netos de ventas (total)"), money0(d.closing.sales), "", ""],
      ],
      [2810, 1870, 2810, 1870],
    ),
    body(""),
    body([
      t(
        tr(
          "Each edition of this Summary is generated from a live simulation whose sources and uses ",
          "Cada edição deste Resumo é gerada de uma simulação viva cujas origens e aplicações ",
          "Cada edición de este Resumen se genera de una simulación viva cuyos orígenes y aplicaciones ",
        ),
      ),
      t(tr("reconcile to the cent", "conciliam ao centavo", "concilian al centavo"), { bold: true }),
      t(
        tr(
          " against projected investor profit. The full calculation detail — per-home economics, the month-by-month prospective ledger, the return methodology and the reconciliation statement — is presented in Appendix A.",
          " com o lucro projetado do investidor. O detalhe completo do cálculo — economia por casa, ledger prospectivo mês a mês, metodologia de retorno e demonstrativo de conciliação — está no Apêndice A.",
          " con la utilidad proyectada del inversor. El detalle completo del cálculo — economía por casa, ledger prospectivo mes a mes, metodología de retorno y estado de conciliación — está en el Apéndice A.",
        ),
      ),
    ]),
    h2(tr("Sensitivity — Expected Case", "Sensibilidade — Cenário Esperado", "Sensibilidad — Escenario Esperado")),
    body(
      tr(
        "Each variable below is shocked independently on the Expected Case — the declared base operating case — with all other assumptions held constant; the Stress Case in the table above shows the combined effect of adverse moves occurring together.",
        "Cada variável abaixo é estressada isoladamente sobre o Cenário Esperado — o caso-base operacional declarado — com todas as demais premissas constantes; o Cenário de Estresse na tabela acima mostra o efeito combinado dos movimentos adversos ocorrendo juntos.",
        "Cada variable a continuación se estresa de forma aislada sobre el Escenario Esperado — el caso base operativo declarado — con todos los demás supuestos constantes; el Escenario de Estrés en la tabla anterior muestra el efecto combinado de los movimientos adversos ocurriendo juntos.",
      ),
    ),
    gridTable(
      [
        tr("Shock", "Choque", "Choque"),
        tr("Projected net IRR", "TIR líquida projetada", "TIR neta proyectada"),
        tr("Investor profit", "Lucro do investidor", "Utilidad del inversor"),
      ],
      [
        [
          tr(`— Expected Case (none)`, `— Cenário Esperado (nenhum)`, `— Escenario Esperado (ninguno)`),
          pct(expected.irrAnnual),
          money0(expected.profit),
        ],
        ...d.sensitivity.map((s) => [
          // labels vêm do report-data em inglês — mapa fixo p/ PT/ES
          tr(
            s.label,
            s.label
              .replace("Sale price", "Preço de venda")
              .replace("Construction cost", "Custo de obra")
              .replace("Timeline +2 months", "Prazo +2 meses")
              .replace("Timeline −2 months", "Prazo −2 meses"),
            s.label
              .replace("Sale price", "Precio de venta")
              .replace("Construction cost", "Costo de obra")
              .replace("Timeline +2 months", "Plazo +2 meses")
              .replace("Timeline −2 months", "Plazo −2 meses"),
          ),
          pct(s.irr),
          money0(s.profit),
        ]),
      ],
      [4160, 2600, 2600],
    ),
    body(""),
    body([
      t("Breakeven: ", { bold: true }),
      t(
        d.breakevenPriceDropPct == null
          ? tr(
              "investor profit remains positive even under a sale-price decline of more than 60% versus the Expected Case — beyond any observed correction in the target submarkets.",
              "o lucro do investidor permanece positivo mesmo com queda de preço de venda superior a 60% versus o Cenário Esperado — além de qualquer correção observada nos submercados-alvo.",
              "la utilidad del inversor permanece positiva incluso con una caída del precio de venta superior al 60% versus el Escenario Esperado — más allá de cualquier corrección observada en los submercados objetivo.",
            )
          : tr(
              `investor profit reaches zero at a sale-price decline of approximately ${d.breakevenPriceDropPct.toFixed(1)}% versus the Expected Case — whose sale-price assumptions are themselves positioned against closed comparables in Section 3, not asking prices.`,
              `o lucro do investidor zera com queda de preço de venda de aproximadamente ${d.breakevenPriceDropPct.toFixed(1)}% versus o Cenário Esperado — cujas premissas de preço são, elas próprias, posicionadas contra comparáveis fechados na Seção 3, não preços de anúncio.`,
              `la utilidad del inversor llega a cero con una caída del precio de venta de aproximadamente ${d.breakevenPriceDropPct.toFixed(1)}% versus el Escenario Esperado — cuyos supuestos de precio están, a su vez, posicionados contra comparables cerrados en la Sección 3, no precios de lista.`,
            ),
      ),
    ]),

    // ── 7. STRUCTURE ──
    h1(tr("7. Structure, Terms & Governance", "7. Estrutura, Termos e Governança", "7. Estructura, Términos y Gobernanza")),
    kvTable([
      ...(isClient
        ? ([
            [
              tr("Entity", "Entidade", "Entidad"),
              tr(
                `${entityName} — formed, owned and governed by the investor group; structure and taxation are the group's own election with its advisors.`,
                `${entityName} — constituída, detida e governada pelo grupo investidor; estrutura e tributação são eleições do próprio grupo com seus assessores.`,
                `${entityName} — constituida, de propiedad y gobernada por el grupo inversor; estructura y tributación son elecciones del propio grupo con sus asesores.`,
              ),
            ],
            [
              "Development Manager",
              tr(
                "Vixus Investment — runs the program under a development management agreement: acquisitions within the disclosed basket, milestone disbursements, sales coordination, platform reporting.",
                "Vixus Investment — opera o programa sob um development management agreement: aquisições dentro da cesta divulgada, desembolsos por marco, coordenação de vendas, relatórios na plataforma.",
                "Vixus Investment — opera el programa bajo un development management agreement: adquisiciones dentro de la canasta divulgada, desembolsos por hito, coordinación de ventas, informes en la plataforma.",
              ),
            ],
            [
              tr("Builder", "Construtora", "Constructora"),
              tr(
                "4U Custom Homes, under the construction contract reflected in the per-home economics of Appendix A.",
                "4U Custom Homes, sob o contrato de obra refletido na economia por casa do Apêndice A.",
                "4U Custom Homes, bajo el contrato de obra reflejado en la economía por casa del Apéndice A.",
              ),
            ],
            [tr("Builder compensation", "Remuneração da construtora", "Compensación de la constructora"), compLabel],
          ] as Array<[string, string]>)
        : ([
            [
              tr("Units", "Cotas", "Unidades"),
              tr(
                "Fixed at $1,000 per unit; ownership percentages are arithmetic. The subscription window closes at land acquisition — no later-stage dilution.",
                "Fixas em $1.000 por cota; os percentuais de participação são aritméticos. A janela de subscrição fecha na aquisição dos lotes — sem diluição posterior.",
                "Fijas en $1,000 por unidad; los porcentajes de participación son aritméticos. La ventana de suscripción cierra en la adquisición de lotes — sin dilución posterior.",
              ),
            ],
            [
              tr("Distributions", "Distribuições", "Distribuciones"),
              tr(
                "Return of capital as home sales close; profit distributed at program completion, pro rata to units held.",
                "Devolução de capital à medida que as vendas fecham; lucro distribuído na conclusão do programa, pro rata às cotas detidas.",
                "Devolución de capital a medida que cierran las ventas; utilidad distribuida al concluir el programa, a prorrata de las unidades.",
              ),
            ],
            [tr("Builder compensation", "Remuneração da construtora", "Compensación de la constructora"), compLabel],
            [
              tr("Manager", "Gestora", "Administrador"),
              tr(
                "Vixus Investment. Investor units are non-voting; investors receive information rights and monthly reporting.",
                "Vixus Investment. As cotas dos investidores não têm voto; os investidores têm direitos de informação e relatórios mensais.",
                "Vixus Investment. Las unidades de los inversores no tienen voto; los inversores tienen derechos de información e informes mensuales.",
              ),
            ],
          ] as Array<[string, string]>)),
      ...(d.hasPromote
        ? ([
            [
              tr("Developer compensation", "Remuneração do developer", "Compensación del developer"),
              tr(
                `Vixus Investment (Development Manager) earns a waterfall only above investor return hurdles (annualized, on average capital at risk): ${tiersText}. Payable at completion — investors are paid their preferred return first.`,
                `A Vixus Investment (Development Manager) recebe waterfall somente acima dos hurdles de retorno do investidor (anualizados, sobre o capital médio em risco): ${tiersText}. Pago na conclusão — os investidores recebem primeiro seu retorno preferencial.`,
                `Vixus Investment (Development Manager) percibe un waterfall solo por encima de los umbrales de retorno del inversor (anualizados, sobre el capital promedio en riesgo): ${tiersText}. Pagadero al cierre — los inversores cobran primero su retorno preferente.`,
              ),
            ],
          ] as Array<[string, string]>)
        : []),
      // Custos do veículo valem independentemente da estrutura (16/07); waiver = abertura isenta
      ...(d.closing.vehicle > 0 || d.waiveFormationCost
        ? ([
            [
              tr("Vehicle costs", "Custos do veículo", "Costos del vehículo"),
              d.waiveFormationCost
                ? tr(
                    "No new entity is formed for this program — it operates through an existing structure, whose formation, accounting and administration costs are absorbed by that structure and therefore do not appear in the program projections.",
                    "Nenhuma entidade nova é constituída para este programa — ele opera por uma estrutura já existente, cujos custos de constituição, contabilidade e administração são absorvidos por essa estrutura e, portanto, não aparecem nas projeções do programa.",
                    "No se constituye entidad nueva para este programa — opera a través de una estructura existente, cuyos costos de constitución, contabilidad y administración son absorbidos por esa estructura y, por lo tanto, no aparecen en las proyecciones del programa.",
                  )
                : tr(
                    "Formation, annual accounting and state filings, and dissolution costs of the vehicle are modeled explicitly as dated cash flows in the projections (Appendix A) — not omitted or footnoted. These costs apply regardless of the vehicle structure chosen.",
                    "Custos de abertura, contabilidade anual e registros estaduais, e de encerramento do veículo são modelados explicitamente como fluxos datados nas projeções (Apêndice A) — não omitidos nem relegados a nota de rodapé. Esses custos existem independentemente da estrutura de veículo escolhida.",
                    "Los costos de constitución, contabilidad anual y registros estatales, y de disolución del vehículo se modelan explícitamente como flujos fechados en las proyecciones (Apéndice A) — no se omiten ni se relegan a nota al pie. Estos costos existen independientemente de la estructura de vehículo elegida.",
                  ),
            ],
          ] as Array<[string, string]>)
        : []),
      ...(isClient
        ? ([
            [
              tr("Offering / tax", "Oferta / tributação", "Oferta / impuestos"),
              d.waiveFormationCost
                ? tr(
                    "No securities are offered by Vixus or 4U; interests, governance and tax elections (including K-1s) are matters of the investor entity and its advisors. Entity costs are absorbed by the existing structure (see Vehicle costs above).",
                    "Nenhum valor mobiliário é ofertado pela Vixus ou pela 4U; participações, governança e eleições tributárias (incluindo K-1s) são matérias da entidade investidora e seus assessores. Os custos da entidade são absorvidos pela estrutura existente (ver Custos do veículo acima).",
                    "Vixus y 4U no ofrecen valores; las participaciones, la gobernanza y las elecciones fiscales (incluidos los K-1) son asuntos de la entidad inversora y sus asesores. Los costos de la entidad son absorbidos por la estructura existente (ver Costos del vehículo arriba).",
                  )
                : tr(
                    "No securities are offered by Vixus or 4U; interests, governance and tax elections (including K-1s) are matters of the investor entity and its advisors. Entity formation and administration costs are provisioned as dated cash flows in the program projections (see Vehicle costs above).",
                    "Nenhum valor mobiliário é ofertado pela Vixus ou pela 4U; participações, governança e eleições tributárias (incluindo K-1s) são matérias da entidade investidora e seus assessores. Custos de constituição e administração da entidade estão provisionados como fluxos datados nas projeções do programa (ver Custos do veículo acima).",
                    "Vixus y 4U no ofrecen valores; las participaciones, la gobernanza y las elecciones fiscales (incluidos los K-1) son asuntos de la entidad inversora y sus asesores. Los costos de constitución y administración de la entidad están provisionados como flujos fechados en las proyecciones del programa (ver Costos del vehículo arriba).",
                  ),
            ],
            [
              tr("Reporting", "Relatórios", "Informes"),
              tr(
                "Platform access for the entity and its members: program statement, per-home budget vs. actual, bank reconciliation support and distribution history.",
                "Acesso à plataforma para a entidade e seus sócios: extrato do programa, orçado × realizado por casa, apoio à conciliação bancária e histórico de distribuições.",
                "Acceso a la plataforma para la entidad y sus socios: estado del programa, presupuesto vs. real por casa, apoyo a la conciliación bancaria e historial de distribuciones.",
              ),
            ],
          ] as Array<[string, string]>)
        : ([
            [
              tr("Offering exemption", "Isenção da oferta", "Exención de la oferta"),
              tr(
                "Rule 506(b) of Regulation D; Florida §517.061(11) as applicable. Schedule K-1 issued annually. One dedicated vehicle per program — entities are never reused across programs.",
                "Rule 506(b) do Regulation D; Flórida §517.061(11) conforme aplicável. Schedule K-1 emitido anualmente. Um veículo dedicado por programa — entidades nunca são reutilizadas entre programas.",
                "Rule 506(b) del Regulation D; Florida §517.061(11) según aplique. Schedule K-1 emitido anualmente. Un vehículo dedicado por programa — las entidades nunca se reutilizan entre programas.",
              ),
            ],
            [
              tr("Reporting", "Relatórios", "Informes"),
              tr(
                "Investor portal: monthly capital statement, per-home budget vs. actual, bank-statement reconciliation and distribution history.",
                "Portal do investidor: extrato mensal de capital, orçado × realizado por casa, conciliação com extrato bancário e histórico de distribuições.",
                "Portal del inversor: estado mensual de capital, presupuesto vs. real por casa, conciliación con el estado bancario e historial de distribuciones.",
              ),
            ],
          ] as Array<[string, string]>)),
    ]),
    body(""),
    // Governança e proteções — feedback do advogado 14/07: o documento não dizia quem
    // controla a LLC, quem movimenta a conta e o que acontece quando algo derrapa
    h2(tr("Governance & investor protections", "Governança e proteções ao investidor", "Gobernanza y protecciones al inversor")),
    body([
      t(tr("Control. ", "Controle. ", "Control. "), { bold: true }),
      t(
        isClient
          ? tr(
              "The investor group controls its own entity: its members and their chosen manager govern the vehicle, its agreements and its distributions. Vixus Investment acts strictly under the development management agreement — it runs the program, not the entity — and matters outside that agreement's scope require the entity's own approval.",
              "O grupo investidor controla sua própria entidade: seus sócios e o administrador que escolherem governam o veículo, seus contratos e suas distribuições. A Vixus Investment atua estritamente sob o development management agreement — opera o programa, não a entidade — e matérias fora do escopo desse contrato exigem aprovação da própria entidade.",
              "El grupo inversor controla su propia entidad: sus socios y el administrador que elijan gobiernan el vehículo, sus contratos y sus distribuciones. Vixus Investment actúa estrictamente bajo el development management agreement — opera el programa, no la entidad — y los asuntos fuera del alcance de ese contrato requieren la aprobación de la propia entidad.",
            )
          : tr(
              "The company is manager-managed: Vixus Investment, as manager, conducts the ordinary course of the program — land acquisition within the disclosed basket, construction disbursements, sales and distributions. Investors hold non-voting units with full information rights. Matters outside the ordinary course, including amendments to the operating agreement and transactions with affiliates beyond the disclosed construction arrangement, are governed by the operating agreement.",
              "A empresa é manager-managed: a Vixus Investment, como manager, conduz o curso ordinário do programa — aquisição de lotes dentro da cesta divulgada, desembolsos de obra, vendas e distribuições. Os investidores detêm cotas sem voto com plenos direitos de informação. Matérias fora do curso ordinário, incluindo alterações do operating agreement e transações com afiliadas além do arranjo de obra divulgado, são regidas pelo operating agreement.",
              "La compañía es manager-managed: Vixus Investment, como manager, conduce el curso ordinario del programa — adquisición de lotes dentro de la canasta divulgada, desembolsos de obra, ventas y distribuciones. Los inversores tienen unidades sin voto con plenos derechos de información. Los asuntos fuera del curso ordinario, incluidas las enmiendas al operating agreement y las transacciones con afiliadas más allá del arreglo de obra divulgado, se rigen por el operating agreement.",
            ),
      ),
    ]),
    body([
      t(tr("Bank account and cash controls. ", "Conta bancária e controles de caixa. ", "Cuenta bancaria y controles de caja. "), { bold: true }),
      t(
        isClient
          ? tr(
              "The program's bank account belongs to the investor entity and remains under the group's own control. Vixus requests disbursements against the milestone schedule reflected in Appendix A; the Builder is never paid on demand. Every movement is recorded in the platform ledger and reconciled against the entity's bank statement, and the entity's members see the same reconciliation on the platform — the group holds the money, Vixus runs the program.",
              "A conta bancária do programa pertence à entidade investidora e permanece sob controle do próprio grupo. A Vixus solicita desembolsos contra o cronograma de marcos refletido no Apêndice A; a Construtora nunca é paga sob demanda. Todo movimento é registrado no ledger da plataforma e conciliado com o extrato bancário da entidade, e os sócios veem a mesma conciliação na plataforma — o grupo detém o dinheiro, a Vixus opera o programa.",
              "La cuenta bancaria del programa pertenece a la entidad inversora y permanece bajo control del propio grupo. Vixus solicita desembolsos contra el cronograma de hitos reflejado en el Apéndice A; la Constructora nunca cobra a demanda. Cada movimiento se registra en el ledger de la plataforma y se concilia con el estado bancario de la entidad, y los socios ven la misma conciliación en la plataforma — el grupo custodia el dinero, Vixus opera el programa.",
            )
          : tr(
              "The program’s bank account is held in the company’s own name and operated by the Manager. The Builder is never paid on demand: construction funds are released against the milestone disbursement schedule reflected in Appendix A, and every account movement is recorded in the platform ledger and reconciled monthly against the bank statement — investors see the same reconciliation on the portal, not a summary prepared separately for them.",
              "A conta bancária do programa é aberta em nome da própria empresa e operada pela Gestora. A Construtora nunca é paga sob demanda: os recursos de obra são liberados contra o cronograma de desembolso por marcos refletido no Apêndice A, e todo movimento da conta é registrado no ledger da plataforma e conciliado mensalmente com o extrato bancário — os investidores veem a mesma conciliação no portal, não um resumo preparado à parte para eles.",
              "La cuenta bancaria del programa está a nombre de la propia compañía y es operada por el Administrador. La Constructora nunca cobra a demanda: los fondos de obra se liberan contra el cronograma de desembolsos por hitos reflejado en el Apéndice A, y cada movimiento de la cuenta se registra en el ledger de la plataforma y se concilia mensualmente con el estado bancario — los inversores ven la misma conciliación en el portal, no un resumen preparado por separado para ellos.",
            ),
      ),
    ]),
    body([
      t(tr("If the program slips. ", "Se o programa derrapar. ", "Si el programa se desvía. "), { bold: true }),
      t(
        tr(
          "The underwriting funds a contingency reserve, and the raise is sized to the Stress Case of Section 6 — which assumes discounted sale prices, cost overruns and extended construction and marketing timelines occurring together. Cost overruns draw on the contingency reserve first",
          "A subscrição financia uma reserva de contingência, e a captação é dimensionada pelo Cenário de Estresse da Seção 6 — que assume preços descontados, estouros de custo e prazos de obra e venda estendidos ocorrendo juntos. Estouros de custo consomem primeiro a reserva de contingência",
          "La suscripción financia una reserva de contingencia, y la captación se dimensiona por el Escenario de Estrés de la Sección 6 — que asume precios descontados, sobrecostos y plazos de obra y venta extendidos ocurriendo juntos. Los sobrecostos consumen primero la reserva de contingencia",
        ) +
          (d.compMode === "OPEN_BOOK"
            ? tr(
                "; under the open-book model the Builder’s fee is fixed per home, so overruns do not increase the Builder’s compensation.",
                "; no modelo open book a taxa da Construtora é fixa por casa, então estouros não aumentam a remuneração da Construtora.",
                "; bajo el modelo de libro abierto la tarifa de la Constructora es fija por casa, así que los sobrecostos no aumentan su compensación.",
              )
            : d.compMode === "PERFORMANCE" || d.compMode === "PROMOTE"
              ? tr(
                  "; under the performance model, overruns reduce the Builder’s own share before they reach investor capital.",
                  "; no modelo de performance, estouros reduzem a fatia da própria Construtora antes de alcançarem o capital do investidor.",
                  "; bajo el modelo de desempeño, los sobrecostos reducen la porción de la propia Constructora antes de alcanzar el capital del inversor.",
                )
              : tr(
                  "; construction cost risk within the fixed-price contract is borne by the Builder.",
                  "; o risco de custo dentro do contrato a preço fixo é da Construtora.",
                  "; el riesgo de costo dentro del contrato a precio fijo lo asume la Constructora.",
                )) +
          tr(
            " Slower sales extend the timeline rather than force distressed pricing — the sensitivity table in Section 6 quantifies the effect on returns, and the breakeven analysis states how much price decline the program tolerates before investor capital is impaired.",
            " Vendas mais lentas estendem o cronograma em vez de forçar preços de liquidação — a tabela de sensibilidade da Seção 6 quantifica o efeito nos retornos, e a análise de breakeven diz quanta queda de preço o programa tolera antes de o capital do investidor ser afetado.",
            " Las ventas más lentas extienden el cronograma en lugar de forzar precios de liquidación — la tabla de sensibilidad de la Sección 6 cuantifica el efecto en los retornos, y el análisis de breakeven indica cuánta caída de precio tolera el programa antes de afectar el capital del inversor.",
          ) +
          (d.projectPhases.loan
            ? tr(
                " Where construction debt is used, facility term overruns and extension fees are modeled explicitly (Section 5) rather than discovered later.",
                " Onde há dívida de obra, estouros de prazo da linha e extension fees são modelados explicitamente (Seção 5), não descobertos depois.",
                " Donde hay deuda de obra, los excesos de plazo de la línea y las extension fees se modelan explícitamente (Sección 5), no se descubren después.",
              )
            : "") +
          tr(
            " Monthly reporting against the per-home budget surfaces deviations early, while corrective options — repricing, re-sequencing starts, or pausing acquisitions not yet contracted — remain available.",
            " O relatório mensal contra o orçamento por casa expõe desvios cedo, enquanto opções corretivas — reprecificar, re-sequenciar inícios ou pausar aquisições ainda não contratadas — permanecem disponíveis.",
            " El informe mensual contra el presupuesto por casa expone desvíos temprano, mientras las opciones correctivas — reajustar precios, re-secuenciar inicios o pausar adquisiciones aún no contratadas — permanecen disponibles.",
          ),
      ),
    ]),
    new Paragraph({
      spacing: { after: 200, line: 264 },
      children: [
        new TextRun({
          text: isClient
            ? tr(
                "Definitive terms are those of the development management agreement, the construction contract and the investor entity's own governing documents, which prevail over this summary.",
                "Os termos definitivos são os do development management agreement, do contrato de obra e dos documentos societários da própria entidade investidora, que prevalecem sobre este resumo.",
                "Los términos definitivos son los del development management agreement, el contrato de obra y los documentos societarios de la propia entidad inversora, que prevalecen sobre este resumen.",
              )
            : tr(
                "Definitive governance, consent and transfer provisions are those of the operating agreement and subscription documents, which prevail over this summary.",
                "As disposições definitivas de governança, consentimento e transferência são as do operating agreement e dos documentos de subscrição, que prevalecem sobre este resumo.",
                "Las disposiciones definitivas de gobernanza, consentimiento y transferencia son las del operating agreement y los documentos de suscripción, que prevalecen sobre este resumen.",
              ),
          font: FONT,
          size: 16,
          color: GRAY,
          italics: true,
        }),
      ],
    }),

    // ── 8. RISKS ──
    new Paragraph({ children: [new PageBreak()] }),
    h1(tr("8. Risk Factors & Mitigants", "8. Fatores de Risco e Mitigantes", "8. Factores de Riesgo y Mitigantes")),
    // Introdução reescrita a pedido do Stefan (16/07 — "hoje ela assusta o investidor"):
    // tom de gestão de risco, não de aviso; a linguagem dura de perda total permanece nos
    // Important Notices, onde o advogado a validou.
    body(
      tr(
        "As with any real estate development investment, the Project is subject to risks inherent to market conditions, construction execution, regulatory matters and other external factors. The investment strategy has been structured to reduce these risks through rigorous selection criteria, operational controls and governance. The principal risks and their respective mitigants are summarized below; the complete statement of risk factors will be included in the definitive offering documents.",
        "Como qualquer investimento em desenvolvimento imobiliário, o Projeto está sujeito a riscos inerentes às condições de mercado, execução da obra, aspectos regulatórios e demais fatores externos. A estratégia de investimento foi estruturada para reduzir esses riscos por meio de critérios rigorosos de seleção, controles operacionais e governança. Os principais riscos e respectivas medidas mitigadoras são resumidos a seguir. A relação completa constará da documentação definitiva da oferta.",
        "Como toda inversión en desarrollo inmobiliario, el Proyecto está sujeto a riesgos inherentes a las condiciones de mercado, la ejecución de la obra, aspectos regulatorios y demás factores externos. La estrategia de inversión fue estructurada para reducir esos riesgos mediante criterios rigurosos de selección, controles operativos y gobernanza. Los principales riesgos y sus respectivas medidas mitigantes se resumen a continuación. La relación completa constará en la documentación definitiva de la oferta.",
      ),
    ),
    h2(tr("Market risk", "Risco de mercado", "Riesgo de mercado")),
    body(
      tr(
        "Home prices and absorption in the target submarkets may decline. Mitigants: the raise is sized to the Stress Case, which underwrites discounted sale prices and extended marketing periods; the product is positioned at entry-level price points, where the buyer pool is deepest; weekly MLS analytics are monitored for early signs of deterioration; and lender loan-to-value caps provide an independent third-party check on value.",
        "Preços e absorção nos submercados-alvo podem cair. Mitigantes: a captação é dimensionada pelo Cenário de Estresse, que subscreve preços descontados e períodos de venda estendidos; o produto é posicionado em faixas de entrada, onde o pool de compradores é mais profundo; as análises semanais do MLS são monitoradas para sinais precoces de deterioração; e os tetos de loan-to-value dos bancos fornecem uma checagem independente de valor.",
        "Los precios y la absorción en los submercados objetivo pueden caer. Mitigantes: la captación se dimensiona por el Escenario de Estrés, que suscribe precios descontados y períodos de venta extendidos; el producto se posiciona en rangos de entrada, donde el grupo de compradores es más profundo; los análisis semanales del MLS se monitorean para detectar señales tempranas de deterioro; y los topes de loan-to-value de los bancos aportan una verificación independiente de valor.",
      ),
    ),
    h2(tr("Construction cost and schedule risk", "Risco de custo e prazo de obra", "Riesgo de costo y plazo de obra")),
    body(
      tr(
        "Costs may exceed budget and construction may take longer than projected. Mitigants: a fixed product line of repeatedly built plans with known cost history; vertical integration in truss supply; a funded contingency reserve; and the Stress Case applies buffers to both cost and duration on top of the Expected Case.",
        "Custos podem exceder o orçamento e a obra pode demorar mais que o projetado. Mitigantes: linha fixa de plantas repetidamente construídas com histórico de custo conhecido; verticalização no fornecimento de treliças; reserva de contingência financiada; e o Cenário de Estresse aplica buffers de custo e prazo por cima do Cenário Esperado.",
        "Los costos pueden exceder el presupuesto y la obra puede tardar más de lo proyectado. Mitigantes: línea fija de plantas construidas repetidamente con historial de costos conocido; integración vertical en el suministro de cerchas; reserva de contingencia financiada; y el Escenario de Estrés aplica buffers de costo y plazo por encima del Escenario Esperado.",
      ),
    ),
    h2(tr("Permitting risk", "Risco de licenciamento", "Riesgo de permisos")),
    body(
      tr(
        "Permit issuance may be delayed. Mitigants: submarkets are selected in part for permit velocity; the Pipeline files permit applications ahead of need; and construction lenders do not close until the substantial majority of permits are issued, which independently disciplines the schedule.",
        "A emissão de permits pode atrasar. Mitigantes: os submercados são selecionados em parte pela velocidade de permit; a Esteira protocola pedidos com antecedência; e os bancos de obra não fecham até a maioria substancial dos permits estar emitida, o que disciplina o cronograma de forma independente.",
        "La emisión de permisos puede demorarse. Mitigantes: los submercados se seleccionan en parte por la velocidad de permisos; el Pipeline presenta solicitudes por adelantado; y los bancos de obra no cierran hasta que la mayoría sustancial de los permisos esté emitida, lo que disciplina el cronograma de forma independiente.",
      ),
    ),
    h2(tr("Financing risk", "Risco de financiamento", "Riesgo de financiamiento")),
    body(
      tr(
        "Construction credit may become more expensive or unavailable, and facilities carry maturity and extension provisions. Mitigants: facilities are modeled line-by-line from executed term sheets, including extension fees where a scenario exceeds the facility term; interest accrues on drawn balances only; and the program can operate on an all-equity basis at reduced scale if credit conditions deteriorate.",
        "O crédito de obra pode encarecer ou faltar, e as linhas têm vencimento e provisões de extensão. Mitigantes: as linhas são modeladas linha a linha a partir de term sheets assinados, incluindo extension fees quando um cenário excede o prazo; juros incidem só sobre o saldo sacado; e o programa pode operar 100% equity em escala reduzida se o crédito piorar.",
        "El crédito de obra puede encarecerse o faltar, y las líneas tienen vencimiento y provisiones de extensión. Mitigantes: las líneas se modelan línea por línea a partir de term sheets firmados, incluidas extension fees cuando un escenario excede el plazo; los intereses se devengan solo sobre el saldo dispuesto; y el programa puede operar 100% con capital propio a escala reducida si el crédito se deteriora.",
      ),
    ),
    h2(tr("Liquidity and concentration risk", "Risco de liquidez e concentração", "Riesgo de liquidez y concentración")),
    body(
      tr(
        "Units are illiquid, transfers are restricted, and the Project is concentrated in Florida residential real estate. Capital may remain committed for the full program duration; investors should commit only capital they can leave invested for the full term.",
        "As cotas são ilíquidas, transferências são restritas e o Projeto é concentrado em imóveis residenciais na Flórida. O capital pode ficar comprometido por toda a duração do programa; os investidores devem comprometer apenas capital que possam deixar investido pelo prazo integral.",
        "Las unidades son ilíquidas, las transferencias están restringidas y el Proyecto está concentrado en inmuebles residenciales de Florida. El capital puede permanecer comprometido durante toda la duración del programa; los inversores deben comprometer solo capital que puedan dejar invertido por el plazo completo.",
      ),
    ),
    h2(tr("Sponsor and key-person risk", "Risco de sponsor e pessoas-chave", "Riesgo de sponsor y personas clave")),
    body(
      tr(
        "The Project depends on the continued involvement of the Builder’s and the Manager’s principals. Mitigants: a standardized product line and documented processes reduce dependence on any individual; builder’s risk insurance is carried during construction; delivered homes carry a 2-10 structural warranty.",
        "O Projeto depende do envolvimento contínuo dos sócios da Construtora e da Gestora. Mitigantes: linha de produto padronizada e processos documentados reduzem a dependência de qualquer indivíduo; seguro builder's risk vigente durante a obra; casas entregues com garantia estrutural 2-10.",
        "El Proyecto depende de la participación continua de los socios de la Constructora y del Administrador. Mitigantes: una línea de producto estandarizada y procesos documentados reducen la dependencia de cualquier individuo; seguro builder's risk vigente durante la obra; las casas entregadas llevan garantía estructural 2-10.",
      ),
    ),
    h2(tr("Projection risk", "Risco de projeção", "Riesgo de proyección")),
    // Conclusão reescrita a pedido do Stefan (16/07): disclaimer sóbrio de projeções em vez
    // do "perdas até a totalidade" — que segue coberto pelos Important Notices.
    body(
      tr(
        "The financial projections presented reflect estimates prepared on the basis of the best information available and assumptions considered reasonable as of the date of this document. Changes in market conditions, costs, execution schedule or other operating factors may result in performance that differs from projections. Accordingly, the projections do not constitute a guarantee of future results.",
        "As projeções financeiras apresentadas refletem estimativas elaboradas com base nas melhores informações disponíveis e em premissas consideradas razoáveis na data deste documento. Alterações nas condições de mercado, custos, cronograma de execução ou demais fatores operacionais poderão resultar em desempenho diferente do projetado. Consequentemente, as projeções não constituem garantia de resultados futuros.",
        "Las proyecciones financieras presentadas reflejan estimaciones elaboradas con base en la mejor información disponible y en supuestos considerados razonables a la fecha de este documento. Cambios en las condiciones de mercado, los costos, el cronograma de ejecución u otros factores operativos podrán resultar en un desempeño diferente al proyectado. En consecuencia, las proyecciones no constituyen garantía de resultados futuros.",
      ),
    ),

    // ── CLOSING REMARKS — sempre presente; a IA (quando gerada) resume os números e o
    // documento termina em filosofia, não em números (feedback 15/07) ──
    h1(tr("9. Closing Remarks", "9. Considerações Finais", "9. Consideraciones Finales")),
    ...(prose?.closingRemarks ? [body(prose.closingRemarks), aiNote(d, prose)] : []),
    body([
      t(
        tr(
          "The objective of this program is not to maximize projected returns on paper, but to preserve investor capital while delivering attractive risk-adjusted performance through disciplined execution.",
          "O objetivo deste programa não é maximizar retornos projetados no papel, mas preservar o capital do investidor entregando performance atrativa ajustada ao risco, por meio de execução disciplinada.",
          "El objetivo de este programa no es maximizar retornos proyectados en el papel, sino preservar el capital del inversor entregando un desempeño atractivo ajustado al riesgo, mediante una ejecución disciplinada.",
        ),
        { italics: true },
      ),
    ]),

    // ── DISCLOSURES ──
    h1(tr("10. Additional Disclosures", "10. Divulgações Adicionais", "10. Divulgaciones Adicionales")),
    body(
      tr(
        "No person has been authorized to make any representation not contained in this Summary, and any such representation must not be relied upon. Delivery of this Summary does not imply that the information herein is correct as of any date after the date on the cover. Prior performance of the Builder, the Manager or their affiliates — including homes delivered and sales volume — is not indicative of the Project’s future results. Certain figures herein are generated by the Manager’s simulation platform as of the date on the cover and are refreshed with each edition; the underlying assumptions are available to prospective investors upon request. This Summary is confidential and may not be reproduced or distributed, in whole or in part, without the Manager’s prior written consent.",
        "Nenhuma pessoa foi autorizada a fazer qualquer declaração não contida neste Resumo, e nenhuma declaração desse tipo deve ser considerada. A entrega deste Resumo não implica que as informações aqui contidas estejam corretas em qualquer data posterior à data da capa. O desempenho passado da Construtora, da Gestora ou de suas afiliadas — incluindo casas entregues e volume de vendas — não é indicativo dos resultados futuros do Projeto. Certos números aqui apresentados são gerados pela plataforma de simulação da Gestora na data da capa e atualizados a cada edição; as premissas subjacentes estão disponíveis aos investidores mediante solicitação. Este Resumo é confidencial e não pode ser reproduzido ou distribuído, no todo ou em parte, sem o consentimento prévio e por escrito da Gestora.",
        "Ninguna persona ha sido autorizada a hacer declaración alguna no contenida en este Resumen, y ninguna declaración de ese tipo debe ser considerada. La entrega de este Resumen no implica que la información aquí contenida sea correcta en fecha posterior a la de la portada. El desempeño pasado de la Constructora, del Administrador o de sus afiliadas — incluidas casas entregadas y volumen de ventas — no es indicativo de los resultados futuros del Proyecto. Ciertas cifras aquí presentadas son generadas por la plataforma de simulación del Administrador a la fecha de la portada y se actualizan con cada edición; los supuestos subyacentes están disponibles para los inversores a solicitud. Este Resumen es confidencial y no puede reproducirse ni distribuirse, total o parcialmente, sin el consentimiento previo por escrito del Administrador.",
      ),
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
        new TextRun({
          text: tr("Our commitment is simple: ", "Nosso compromisso é simples: ", "Nuestro compromiso es simple: "),
          font: FONT,
          size: 22,
          bold: true,
          color: NAVY,
        }),
        new TextRun({
          text: tr(
            "preserve investor capital first, execute with discipline, and pursue attractive risk-adjusted returns through transparency, technology, and operational excellence.",
            "preservar o capital do investidor em primeiro lugar, executar com disciplina e buscar retornos atrativos ajustados ao risco por meio de transparência, tecnologia e excelência operacional.",
            "preservar el capital del inversor en primer lugar, ejecutar con disciplina y buscar retornos atractivos ajustados al riesgo mediante transparencia, tecnología y excelencia operativa.",
          ),
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
      children: [
        t(
          tr(
            "Contact: Vixus Investment · 8250 Exchange Dr, Suite 134, Orlando, FL 32809",
            "Contato: Vixus Investment · 8250 Exchange Dr, Suite 134, Orlando, FL 32809",
            "Contacto: Vixus Investment · 8250 Exchange Dr, Suite 134, Orlando, FL 32809",
          ),
          { color: GRAY },
        ),
      ],
    }),

    // ── APPENDIX A ──
    new Paragraph({ children: [new PageBreak()] }),
    h1(tr("Appendix A — Financial Detail", "Apêndice A — Detalhe Financeiro", "Apéndice A — Detalle Financiero")),
    body(
      tr(
        "This appendix opens the calculations behind the projections in Section 6. Every table is produced by the same simulation engine, on the same assumptions, for the Expected Case — the base operating case; the Stress and Upside Cases differ only by the disclosed scenario buffers. No figure is entered by hand.",
        "Este apêndice abre os cálculos por trás das projeções da Seção 6. Toda tabela é produzida pelo mesmo motor de simulação, com as mesmas premissas, para o Cenário Esperado — o caso-base operacional; os Cenários de Estresse e de Alta diferem apenas pelos buffers divulgados. Nenhum número é digitado à mão.",
        "Este apéndice abre los cálculos detrás de las proyecciones de la Sección 6. Cada tabla es producida por el mismo motor de simulación, con los mismos supuestos, para el Escenario Esperado — el caso base operativo; los Escenarios de Estrés y de Alza difieren solo por los buffers divulgados. Ninguna cifra se ingresa a mano.",
      ),
    ),
    h2(tr("A.1  Per-home economics", "A.1  Economia por casa", "A.1  Economía por casa")),
    body(
      tr(
        "Unit-level underwriting for each home in the program basket, at Expected Case values. Sale proceeds are shown net of closing costs; permit costs are embedded in the construction disbursement schedule; financing costs and performance-based builder compensation accrue at program level and appear in A.4.",
        "Subscrição por unidade para cada casa da cesta do programa, a valores do Cenário Esperado. A receita de venda é líquida de custos de closing; custos de permit estão embutidos no cronograma de desembolso da obra; custos de financiamento e remuneração por performance da construtora acumulam no nível do programa e aparecem no A.4.",
        "Suscripción por unidad para cada casa de la canasta del programa, a valores del Escenario Esperado. Los ingresos de venta son netos de costos de cierre; los costos de permisos están incluidos en el cronograma de desembolsos de obra; los costos de financiamiento y la compensación por desempeño de la constructora se acumulan a nivel del programa y aparecen en A.4.",
      ),
    ),
    ...(d.customAssumptions > 0
      ? [
          body([
            t(
              tr(
                `Certain underwriting assumptions (${d.customAssumptions} value${d.customAssumptions > 1 ? "s" : ""} — sale prices, costs, timelines and/or scenario parameters) were adjusted by the Manager specifically for this program and differ from the Manager's standing catalog; catalog reference values are available to prospective investors upon request.`,
                `Certas premissas de subscrição (${d.customAssumptions} valor${d.customAssumptions > 1 ? "es" : ""} — preços de venda, custos, prazos e/ou parâmetros de cenário) foram ajustadas pela Gestora especificamente para este programa e diferem do catálogo padrão da Gestora; valores de referência do catálogo estão disponíveis aos investidores mediante solicitação.`,
                `Ciertos supuestos de suscripción (${d.customAssumptions} valor${d.customAssumptions > 1 ? "es" : ""} — precios de venta, costos, plazos y/o parámetros de escenario) fueron ajustados por el Administrador específicamente para este programa y difieren del catálogo estándar del Administrador; los valores de referencia del catálogo están disponibles para los inversores a solicitud.`,
              ),
              { size: 18, color: GRAY, italics: true },
            ),
          ]),
        ]
      : []),
    gridTable(
      [
        tr("Home", "Casa", "Casa"),
        tr("Lot", "Lote", "Lote"),
        tr("Construction", "Obra", "Obra"),
        tr("Sale (net)", "Venda (líq.)", "Venta (neta)"),
        tr("Net profit", "Lucro líquido", "Utilidad neta"),
      ],
      [
        ...d.base.units.map((u) => [
          u.label,
          money0(u.adjLot),
          money0(u.adjBuild),
          money0(u.adjSaleNet),
          money0(u.profit),
        ]),
        [
          tr("Program total", "Total do programa", "Total del programa"),
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
    h2(tr("A.2  Month-by-month prospective ledger", "A.2  Ledger prospectivo mês a mês", "A.2  Ledger prospectivo mes a mes")),
    body(
      tr(
        "The program’s full projected cash movement by month: capital calls, land and permits, construction disbursements (including builder compensation), net bank flows (draws in, fees, interest and payoff out), sale closings and distributions — running to a cash balance that never goes below zero. This is the ledger on which the IRR is computed; the complete dated, line-item ledger is available on the Manager’s platform.",
        "Todo o movimento de caixa projetado do programa, por mês: chamadas de capital, lotes e permits, desembolsos de obra (incluindo remuneração da construtora), fluxos líquidos do banco (draws entrando; taxas, juros e payoff saindo), closings de venda e distribuições — com saldo de caixa que nunca fica negativo. É sobre este ledger que a TIR é calculada; o ledger completo, datado e linha a linha, está disponível na plataforma da Gestora.",
        "Todo el movimiento de caja proyectado del programa, por mes: llamadas de capital, lotes y permisos, desembolsos de obra (incluida la compensación de la constructora), flujos netos del banco (desembolsos entrando; comisiones, intereses y payoff saliendo), cierres de venta y distribuciones — con un saldo de caja que nunca es negativo. Sobre este ledger se calcula la TIR; el ledger completo, fechado y línea por línea, está disponible en la plataforma del Administrador.",
      ),
    ),
    gridTable(
      [
        tr("Month", "Mês", "Mes"),
        tr("Capital calls", "Chamadas", "Llamadas"),
        tr("Land", "Lotes", "Lotes"),
        tr("Construction", "Obra", "Obra"),
        tr("Bank (net)", "Banco (líq.)", "Banco (neto)"),
        tr("Sale proceeds", "Vendas", "Ventas"),
        tr("Distributions", "Distribuições", "Distribuciones"),
        tr("Ending cash", "Caixa final", "Caja final"),
      ],
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
    h2(tr("A.3  Return methodology", "A.3  Metodologia de retorno", "A.3  Metodología de retorno")),
    bullet([
      t(tr("Net IRR", "TIR líquida", "TIR neta"), { bold: true }),
      t(
        tr(
          " is the annualized internal rate of return (XIRR) computed on the dated investor cash flows of the ledger in A.2 — capital calls as outflows, distributions as inflows — after builder compensation and all project-level costs, before investor-level taxes.",
          " é a taxa interna de retorno anualizada (XIRR) calculada sobre os fluxos datados do investidor no ledger do A.2 — chamadas como saídas, distribuições como entradas — após a remuneração da construtora e todos os custos do projeto, antes dos tributos do investidor.",
          " es la tasa interna de retorno anualizada (XIRR) calculada sobre los flujos fechados del inversor en el ledger de A.2 — llamadas como salidas, distribuciones como entradas — después de la compensación de la constructora y todos los costos del proyecto, antes de impuestos del inversor.",
        ),
      ),
    ]),
    bullet([
      t(tr("Equity multiple", "Múltiplo de capital", "Múltiplo de capital"), { bold: true }),
      t(
        tr(
          " is total distributions divided by total capital called.",
          " é o total de distribuições dividido pelo total de capital chamado.",
          " es el total de distribuciones dividido por el total de capital llamado.",
        ),
      ),
    ]),
    bullet([
      t(tr("Peak invested capital", "Pico de capital investido", "Pico de capital invertido"), { bold: true }),
      t(
        tr(
          " is the maximum cumulative capital outstanding at any point in the program — not the sum of all calls. The raise itself is sized on the Stress Case peak (Section 6).",
          " é o máximo de capital acumulado em risco em qualquer ponto do programa — não a soma de todas as chamadas. A captação em si é dimensionada pelo pico do Cenário de Estresse (Seção 6).",
          " es el máximo de capital acumulado en riesgo en cualquier punto del programa — no la suma de todas las llamadas. La captación en sí se dimensiona por el pico del Escenario de Estrés (Sección 6).",
        ),
      ),
    ]),
    bullet(
      tr(
        "Capital calls are just-in-time: capital is called only when projected project cash cannot cover the next obligation, so idle cash does not depress the IRR and investors are never called earlier than the schedule requires.",
        "As chamadas de capital são just-in-time: o capital só é chamado quando o caixa projetado do projeto não cobre a próxima obrigação — caixa parado não deprime a TIR e os investidores nunca são chamados antes do que o cronograma exige.",
        "Las llamadas de capital son just-in-time: el capital solo se llama cuando la caja proyectada del proyecto no cubre la siguiente obligación — la caja ociosa no deprime la TIR y los inversores nunca son llamados antes de lo que el cronograma exige.",
      ),
    ),
    h2(tr("A.4  Reconciliation statement", "A.4  Demonstrativo de conciliação", "A.4  Estado de conciliación")),
    body(
      tr(
        "The identity below is verified by the engine for every scenario before a report can be issued; a discrepancy of even one cent blocks generation.",
        "A identidade abaixo é verificada pelo motor para todos os cenários antes de um report poder ser emitido; uma discrepância de um centavo bloqueia a geração.",
        "La identidad a continuación es verificada por el motor para todos los escenarios antes de que un informe pueda emitirse; una discrepancia de un centavo bloquea la generación.",
      ),
    ),
    kvTable(
      [
        [tr("Total sale proceeds (net of closing costs)", "Receita total de vendas (líquida de custos de closing)", "Ingresos totales de ventas (netos de costos de cierre)"), money2(d.closing.sales)],
        [tr("(−) Land acquisition", "(−) Aquisição de lotes", "(−) Adquisición de lotes"), money2(-d.closing.lots)],
        [
          tr("(−) Vertical construction (incl. embedded builder fees)", "(−) Obra vertical (incl. fees embutidos da construtora)", "(−) Construcción vertical (incl. tarifas incluidas de la constructora)"),
          money2(-d.closing.construction),
        ],
        [
          tr("(−) Financing costs (interest + all lender fees)", "(−) Custos de financiamento (juros + todas as taxas do banco)", "(−) Costos de financiamiento (intereses + todas las comisiones del banco)"),
          money2(-d.closing.bankCost),
        ],
        [tr("(−) Builder compensation (performance)", "(−) Remuneração da construtora (performance)", "(−) Compensación de la constructora (desempeño)"), money2(-d.closing.builderComp)],
        ...(d.closing.promote > 0
          ? ([
              [
                tr("(−) Developer promote (Vixus waterfall)", "(−) Promote do developer (waterfall da Vixus)", "(−) Promote del developer (waterfall de Vixus)"),
                money2(-d.closing.promote),
              ],
            ] as Array<[string, string]>)
          : []),
        ...(d.closing.vehicle > 0
          ? ([
              [
                tr("(−) Vehicle formation & administration", "(−) Constituição e administração do veículo", "(−) Constitución y administración del vehículo"),
                money2(-d.closing.vehicle),
              ],
            ] as Array<[string, string]>)
          : []),
        [
          tr("(=) Investor profit", "(=) Lucro do investidor", "(=) Utilidad del inversor"),
          tr(
            `${money2(d.closing.result)}   (equals Section 6 — difference ${money2(d.closing.diff)})`,
            `${money2(d.closing.result)}   (igual à Seção 6 — diferença ${money2(d.closing.diff)})`,
            `${money2(d.closing.result)}   (igual a la Sección 6 — diferencia ${money2(d.closing.diff)})`,
          ),
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
                children: [
                  new TextRun({ text: tr("CONFIDENTIAL", "CONFIDENCIAL", "CONFIDENCIAL"), font: FONT, size: 16, color: GRAY }),
                ],
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
                    text: tr(
                      `4U Custom Homes × Vixus Investment — Investment Summary · ${d.simName} · Page `,
                      `4U Custom Homes × Vixus Investment — Resumo do Investimento · ${d.simName} · Página `,
                      `4U Custom Homes × Vixus Investment — Resumen de Inversión · ${d.simName} · Página `,
                    ),
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
