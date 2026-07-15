/**
 * Probe do Investment Summary: gera o DOCX de uma simulação real sem passar pelo app.
 * Uso: DATABASE_URL="<prodcopy>" npx tsx scripts/probe-report.ts [trecho-do-nome] [saida.docx]
 * Sem argumento, usa a simulação mais recente.
 */
import fs from "node:fs";
import { Packer } from "docx";
import { prisma } from "../src/lib/db";
import { buildReportData } from "../src/lib/pools/report-data";
import { buildReportDocx } from "../src/lib/pools/report-docx";
import { getReportProse } from "../src/lib/pools/report-ai";

async function main() {
  const namePart = process.argv[2] || "";
  const outPath = process.argv[3] || "probe-report.docx";
  const sim = await prisma.poolSimulation.findFirst({
    where: namePart ? { name: { contains: namePart, mode: "insensitive" } } : {},
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, fundingMode: true },
  });
  if (!sim) throw new Error("Nenhuma simulação encontrada.");
  console.log(`Simulação: ${sim.name} (${sim.fundingMode}) — ${sim.id}`);

  const data = await buildReportData(sim.id);
  if ("error" in data) throw new Error(data.error);
  console.log(
    `Cenários: ${data.scenarios.map((s) => `${s.code} TIR ${s.irrAnnual == null ? "—" : (s.irrAnnual * 100).toFixed(1) + "%"} lucro $${Math.round(s.profit).toLocaleString()}`).join(" · ")}`,
  );
  console.log(`Ciclos: ${data.cycles.map((c) => `C${c.cycle}=${c.homes}`).join(" ")} · singleShotPeak: ${data.singleShotPeak ?? "—"}`);
  console.log(`Sensibilidade: ${data.sensitivity.map((s) => `${s.label}: ${s.irr == null ? "—" : (s.irr * 100).toFixed(1) + "%"}`).join(" · ")}`);
  console.log(`Breakeven queda de preço: ${data.breakevenPriceDropPct ?? ">60"}%`);
  console.log(`Fechamento: resultado $${data.closing.result.toLocaleString()} · diff $${data.closing.diff.toFixed(2)}`);
  console.log(`Ledger mensal: ${data.monthly.length} meses · Mercado: extrato ${data.market.extractDate}`);
  if (Math.abs(data.closing.diff) > 0.01) throw new Error("Fechamento NÃO bate ao centavo — report seria bloqueado.");

  const lang = (["en", "pt", "es"].includes(process.argv[4] ?? "") ? process.argv[4] : "en") as "en" | "pt" | "es";
  // prosa da Claude quando a chave existe (mesmo caminho da rota); sem chave → sem prosa
  const prose = process.env.ANTHROPIC_API_KEY ? await getReportProse(sim.id, data, lang) : null;
  if (prose) {
    console.log(`Prosa AI (${prose.model}, cache hash ok):`);
    for (const p of prose.marketCommentary) console.log(`  [market] ${p.slice(0, 140)}…`);
    console.log(`  [closing] ${prose.closingRemarks.slice(0, 140)}…`);
  } else console.log("Prosa AI: — (sem chave ou falha — report sai sem a seção)");

  const buf = await Packer.toBuffer(buildReportDocx(data, undefined, prose, lang));
  fs.writeFileSync(outPath, buf);
  console.log(`DOCX (${lang}): ${outPath} (${(buf.byteLength / 1024).toFixed(0)} KB)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
