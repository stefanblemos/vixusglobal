import { auth } from "@/auth";
import { buildTaxPreview } from "@/lib/tax/preview";
import { irTaxableConfidence } from "@/lib/tax/audit-vs-ir";
import { toCsv, csvResponse } from "@/lib/export/csv";

const CONF_LABEL: Record<string, string> = { match: "confere com IR", diverge: "diverge do IR", none: "sem IR (estimado)" };

export async function GET(req: Request) {
  if (!(await auth())) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getUTCFullYear() - 1;

  const data = await buildTaxPreview(year);
  const conf = await irTaxableConfidence(
    year,
    data.rows.map((r) => ({ id: r.id, kind: r.kind, entityType: r.entityType, taxable: r.taxable, hasPnl: r.hasPnl })),
  );

  const rows: (string | number)[][] = [
    [`Tax preview ${year} — Vixus (estimativa de controle; confirmar com o contador)`],
    [],
    ["Entidade", "Tipo", "Lucro líquido", "Não dedutíveis (M-1)", "Add-back estadual", "Ajuste depreciação", "K-1 recebido", "Base tributável", "IR estimado", "Confere com IR"],
  ];
  for (const r of data.rows) {
    rows.push([
      r.name,
      r.entityType,
      r.kind === "person" ? "" : r.bookNet,
      r.nonDeductible,
      r.stateTaxAddBack,
      r.macrsApplied ? r.depAdj : "",
      r.k1In,
      r.taxable,
      r.tax,
      r.kind === "company" && r.hasPnl ? (CONF_LABEL[conf[r.id]] ?? "") : "",
    ]);
  }
  rows.push([]);
  rows.push(["TOTAL grupo", "", "", "", "", "", "", "", data.groupTax, ""]);
  rows.push(["  C-corps (federal)", "", "", "", "", "", "", "", data.corpTax, ""]);
  rows.push(["  Pessoas físicas (1040)", "", "", "", "", "", "", "", data.pfTax, ""]);

  return csvResponse(toCsv(rows), `vixus-tax-preview-${year}.csv`);
}
