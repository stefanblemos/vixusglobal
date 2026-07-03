import { auth } from "@/auth";
import { buildDistributableReport } from "@/lib/tax/distributable";
import { toCsv, csvResponse } from "@/lib/export/csv";

export async function GET(req: Request) {
  if (!(await auth())) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getUTCFullYear();

  const rep = await buildDistributableReport(year);
  const rows: (string | number)[][] = [
    [`Base distribuível ${year} — renda já tributada (fonte: IR). Confirmar com o contador antes de distribuir.`],
    [],
    ["Destino final", "Tipo", "Origem (pass-through)", "IR (ano)", "Capital account (IR)", "%", "Distribuível sem imposto"],
  ];
  for (const o of rep.owners) {
    if (o.sources.length === 0) {
      rows.push([o.name, o.kind, "(nada distribuível direto)", "", "", "", 0]);
    }
    for (const s of o.sources) {
      rows.push([o.name, o.kind, s.name, s.irYear, s.capitalAccount, s.pct, s.amount]);
    }
    rows.push([`  → TOTAL ${o.name}`, "", "", "", "", "", o.total]);
    for (const t of o.trappedInCorp) {
      rows.push([`  (preso na C-corp ${t.name} — sairia como dividendo)`, "", "", "", "", t.pct, t.share]);
    }
    rows.push([]);
  }
  if (rep.missing.length) {
    rows.push(["Não calculadas (falta IR):"]);
    for (const m of rep.missing) rows.push([m.name, m.reason === "sem-ir" ? "sem IR no app" : "IR sem a figura capital account"]);
  }

  return csvResponse(toCsv(rows), `vixus-base-distribuivel-${year}.csv`);
}
