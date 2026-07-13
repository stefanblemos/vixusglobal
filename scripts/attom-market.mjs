// Gera src/data/market-stats.json a partir do CSV semanal do ATTOM (Listing Analytics).
// Uso: node scripts/attom-market.mjs "C:\caminho\4U CUSTOM HOMES_LISTINGANALYTICSCOMPLETE_0001.csv"
// O JSON alimenta a seção "Market Opportunity" do Investment Summary — rodar a cada extrato
// novo e commitar (até a ingestão automática do roadmap assumir isso).
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Passe o caminho do CSV do ATTOM.");
  process.exit(1);
}

// Submarkets do programa → match no LegalSubdivision (Poinciana vem quebrada em villages)
const SUBMARKETS = [
  { key: "marion-oaks", name: "Marion Oaks (Ocala)", match: /MARION OAKS/ },
  { key: "citrus-springs", name: "Citrus Springs", match: /CITRUS SPRINGS/ },
  { key: "poinciana", name: "Poinciana", match: /POINCIANA/ },
];

const parseDate = (s) => {
  // MM/DD/YYYY do ATTOM
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((s ?? "").trim());
  return m ? new Date(Date.UTC(+m[3], +m[1] - 1, +m[2])) : null;
};
const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const rows = Papa.parse(fs.readFileSync(csvPath, "utf8"), { header: true, skipEmptyLines: true }).data;

// Data de referência = venda mais recente do extrato (evita depender do nome do arquivo)
let refDate = null;
for (const r of rows) {
  const d = parseDate(r.MLSSoldDate);
  if (d && (!refDate || d > refDate)) refDate = d;
}
if (!refDate) {
  console.error("Nenhuma MLSSoldDate no CSV — arquivo errado?");
  process.exit(1);
}
const windowStart = new Date(refDate.getTime() - 90 * 86400_000);

const stats = SUBMARKETS.map((sm) => {
  const all = rows.filter(
    (r) => sm.match.test((r.LegalSubdivision ?? "").toUpperCase()) && r.MLSPropertyType === "Residential",
  );
  const sold90 = all.filter((r) => {
    if (r.ListingStatus !== "Sold") return false;
    const d = parseDate(r.MLSSoldDate);
    return d && d >= windowStart && d <= refDate;
  });
  const ppsf = sold90
    .map((r) => Number(r.MLSSoldPrice) / Number(r.LivingAreaSquareFeet))
    .filter((v) => Number.isFinite(v) && v > 30 && v < 1000);
  const dom = sold90.map((r) => Number(r.DaysOnMarket)).filter((v) => Number.isFinite(v) && v >= 0);
  const nc = sold90.filter((r) => (r.NewConstructionYN ?? "").trim() === "Y").length;
  const ncPpsf = sold90
    .filter((r) => (r.NewConstructionYN ?? "").trim() === "Y")
    .map((r) => Number(r.MLSSoldPrice) / Number(r.LivingAreaSquareFeet))
    .filter((v) => Number.isFinite(v) && v > 30 && v < 1000);
  return {
    key: sm.key,
    name: sm.name,
    soldCount90d: sold90.length,
    medianPricePerSf: median(ppsf),
    medianPricePerSfNewConstruction: median(ncPpsf),
    medianDaysOnMarket: median(dom),
    newConstructionSharePct: sold90.length ? Math.round((100 * nc) / sold90.length) : null,
    activeListings: all.filter((r) => r.ListingStatus === "Active").length,
  };
});

const out = {
  source: "ATTOM Listing Analytics (weekly MLS feed)",
  extractDate: refDate.toISOString().slice(0, 10),
  totalListings: rows.length,
  counties: ["Citrus", "Marion", "Polk"],
  windowDays: 90,
  submarkets: stats,
};

const outPath = path.join(import.meta.dirname, "..", "src", "data", "market-stats.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`market-stats.json atualizado (extrato ${out.extractDate}):`);
for (const s of stats)
  console.log(
    `  ${s.name}: ${s.soldCount90d} vendas/90d · $${s.medianPricePerSf?.toFixed(0)}/sf (NC $${s.medianPricePerSfNewConstruction?.toFixed(0)}) · DOM ${s.medianDaysOnMarket} · ${s.newConstructionSharePct}% new construction · ${s.activeListings} ativos`,
  );
