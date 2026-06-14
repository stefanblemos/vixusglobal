import Papa from "papaparse";
import { parseQboNumber } from "./numbers";

export type QboReportType = "BALANCE_SHEET" | "PROFIT_AND_LOSS" | "UNKNOWN";
export type QboLineType = "SECTION" | "ACCOUNT" | "TOTAL";

export interface QboLine {
  label: string; // nome limpo (sem o código entre parênteses)
  accountCode: string | null;
  sectionPath: string[]; // seções ancestrais (ex.: ["Assets","Current Assets","Loans to Others"])
  depth: number;
  lineType: QboLineType;
  values: (string | null)[]; // Decimal-string por coluna de período (null = vazio)
}

export interface QboReport {
  companyName: string;
  reportType: QboReportType;
  reportTypeLabel: string;
  periodLabel: string;
  basis: string | null;
  currency: string; // ISO 4217 detectado pelos símbolos ($→USD, R$→BRL, €→EUR)
  columns: string[]; // cabeçalhos das colunas de período (ex.: ["Total"])
  lines: QboLine[];
}

function detectType(label: string): QboReportType {
  const l = label.toLowerCase();
  if (
    l.includes("balance sheet") ||
    l.includes("balanço patrimonial") ||
    l.includes("balanco patrimonial")
  )
    return "BALANCE_SHEET";
  if (
    l.includes("profit and loss") ||
    l.includes("profit & loss") ||
    l.includes("resultado do exerc") ||
    l.includes("demonstração de result") ||
    l.includes("demonstracao de result")
  )
    return "PROFIT_AND_LOSS";
  return "UNKNOWN";
}

function detectCurrency(text: string): string {
  if (/R\$/.test(text)) return "BRL";
  if (/€/.test(text)) return "EUR";
  if (/£/.test(text)) return "GBP";
  return "USD";
}

const TOTAL_RE = /^total\s+(?:for|para)\s+(.+)$/i;

function extractCode(label: string): { name: string; code: string | null } {
  const m = label.match(/\s*\(([^)]+)\)\s*$/);
  if (m) return { name: label.slice(0, m.index).trim(), code: m[1].trim() };
  return { name: label.trim(), code: null };
}

export function parseQboReport(csvText: string): QboReport {
  const decodeEntities = (s: string) =>
    s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&nbsp;/g, " ");

  const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: false });
  const rows = (parsed.data ?? []).map((r) =>
    (r ?? []).map((c) => decodeEntities((c ?? "").trim())),
  );

  const companyName = rows[0]?.[0] ?? "";
  const reportTypeLabel = rows[1]?.[0] ?? "";
  const periodLabel = rows[2]?.[0] ?? "";

  // Linha de cabeçalho das colunas: col0 vazia e alguma coluna seguinte preenchida.
  const headerIdx = rows.findIndex((r) => (r[0] ?? "") === "" && r.slice(1).some((c) => c !== ""));
  const columns = headerIdx >= 0 ? rows[headerIdx].slice(1).filter((c) => c !== "") : ["Total"];
  const nCols = columns.length;

  // Pré-varredura: nomes que aparecem em "Total for X" são contas-pai/seções —
  // mesmo quando a linha-pai também traz um valor próprio (ex.: cartão com saldo + sub-contas).
  const parentNames = new Set<string>();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const m = (rows[i]?.[0] ?? "").match(TOTAL_RE);
    if (m) parentNames.add(m[1].trim());
  }

  const lines: QboLine[] = [];
  const stack: string[] = [];
  let basis: string | null = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const label = row[0] ?? "";
    if (label === "") continue;

    if (/^(accrual|cash)\s+basis/i.test(label)) {
      basis = label
        .replace(/\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday).*/i, "")
        .trim();
      break;
    }

    const values = Array.from({ length: nCols }, (_, c) => parseQboNumber(row[c + 1]));
    const hasValue = values.some((v) => v !== null);

    const totalMatch = label.match(TOTAL_RE);
    if (totalMatch) {
      const sectionName = totalMatch[1].trim();
      const idx = stack.lastIndexOf(sectionName);
      const depth = idx >= 0 ? idx : Math.max(0, stack.length - 1);
      const path = idx >= 0 ? stack.slice(0, idx) : [...stack];
      lines.push({ label, accountCode: null, sectionPath: path, depth, lineType: "TOTAL", values });
      if (idx >= 0) stack.length = idx;
      else stack.pop();
      continue;
    }

    // Seção/conta-pai: aparece em "Total for X", ou é um cabeçalho sem valor.
    if (parentNames.has(label) || !hasValue) {
      lines.push({
        label,
        accountCode: null,
        sectionPath: [...stack],
        depth: stack.length,
        lineType: "SECTION",
        values,
      });
      stack.push(label);
      continue;
    }

    const { name, code } = extractCode(label);
    lines.push({
      label: name,
      accountCode: code,
      sectionPath: [...stack],
      depth: stack.length,
      lineType: "ACCOUNT",
      values,
    });
  }

  return {
    companyName,
    reportType: detectType(reportTypeLabel),
    reportTypeLabel,
    periodLabel,
    basis,
    currency: detectCurrency(csvText),
    columns,
    lines,
  };
}

/** Soma o valor (1ª coluna) das contas-folha cujo caminho contém a seção dada. */
export function leavesUnderSection(report: QboReport, section: string): QboLine[] {
  return report.lines.filter((l) => l.lineType === "ACCOUNT" && l.sectionPath.includes(section));
}
