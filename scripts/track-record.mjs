// Track record da 4U → src/data/track-record.json (Fase 1.5 do Investment Summary).
// Uso: node scripts/track-record.mjs "C:\caminho\4U Builder.csv"
//
// Lê o export do 4U Builder, filtra obras FECHADAS com lucro realizado e as 4 datas
// (permit, foundation, CO, closing) e agrega:
//   - ROI realizado por ciclo (base confirmada pelo Stefan 15/07: custo TOTAL lote+obra);
//   - TIR ESTIMADA por casa aplicando o plano real de pagamento do cliente
//     10/30/20/20/15/5 sobre as datas reais (XIRR) — estimada, nunca "realizada";
//   - piso conservador: 100% do capital no D0 do ciclo;
//   - correção de permit+holding: gap permit→foundation > 45d ancora o início do
//     ciclo em foundation−10d (mediana dos casos normais) p/ não penalizar a TIR.
// O JSON commitado tem SÓ agregados — nomes de clientes e endereços NÃO saem daqui.
// "active" com Net Profit são projeção do sistema — sempre excluídos.
// Rodar de novo quando o 4U Builder exportar a história completa (pré-296 e 968+).
import fs from "node:fs";
import path from "node:path";

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Uso: node scripts/track-record.mjs "<caminho do 4U Builder.csv>"');
  process.exit(1);
}

// parser simples p/ CSV com todos os campos entre aspas (formato do 4U Builder)
function parseCsv(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const parseLine = (line) => {
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const header = parseLine(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(parseLine(l).map((v, i) => [header[i], v])));
}

const D = (s) => {
  const t = (s ?? "").trim();
  if (!t || t === "-") return null;
  const d = new Date(t + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
};
const days = (a, b) => Math.round((b - a) / 86400000);
const netProfit = (s) => {
  const m = /^\$([\d,]+\.?\d*)\s*\((-?[\d.]+)%\)$/.exec((s ?? "").trim());
  return m ? { profit: Number(m[1].replace(/,/g, "")), roi: Number(m[2]) / 100 } : null;
};

// XIRR por bisseção (fluxos [(date, amount)])
function xirr(flows) {
  const t0 = flows[0][0];
  const npv = (r) => flows.reduce((s, [d, a]) => s + a / (1 + r) ** (days(t0, d) / 365), 0);
  let lo = -0.95;
  let hi = 20;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const pctile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
const r1 = (v) => Math.round(v * 10) / 10;

const TRIGGERS = [0.10, 0.30, 0.20, 0.20, 0.15, 0.05];
const HOLDING_GAP_DAYS = 45; // acima disso = permit+holding (lote esperando o ciclo)
const NORMAL_PERMIT_TO_FOUNDATION = 10; // mediana observada dos casos normais

const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
const prefixes = rows.map((r) => Number(r["Prefix"])).filter((n) => Number.isFinite(n) && n > 0);

const sample = [];
let holdingAdjusted = 0;
for (const r of rows) {
  if ((r["Status"] ?? "").trim() !== "closed") continue; // active c/ lucro = projeção, fora
  const np = netProfit(r["Net Profit"]);
  const pi = D(r["Permit Issue"]);
  const fo = D(r["Foundation"]);
  const co = D(r["CO Issue"]);
  const cl = D(r["Closing Date"]);
  if (!np || !pi || !fo || !co || !cl) continue;

  const cost = np.profit / np.roi; // base confirmada: custo total (lote + obra)
  const sale = cost + np.profit;
  let start = pi;
  if (days(pi, fo) > HOLDING_GAP_DAYS) {
    start = new Date(fo.getTime() - NORMAL_PERMIT_TO_FOUNDATION * 86400000);
    holdingAdjusted++;
  }
  const span = days(fo, co);
  const m1 = new Date(fo.getTime() + Math.round(span / 3) * 86400000);
  const m2 = new Date(fo.getTime() + Math.round((2 * span) / 3) * 86400000);
  const flows = [
    [start, -TRIGGERS[0] * cost],
    [fo, -TRIGGERS[1] * cost],
    [m1, -TRIGGERS[2] * cost],
    [m2, -TRIGGERS[3] * cost],
    [co, -TRIGGERS[4] * cost],
    [cl, -TRIGGERS[5] * cost],
    [cl, sale],
  ].sort((a, b) => a[0] - b[0]);

  const cycleDays = days(start, cl);
  sample.push({
    year: cl.getUTCFullYear(),
    roi: np.roi,
    irr: xirr(flows),
    irrFloor: (1 + np.roi) ** (365 / cycleDays) - 1, // capital 100% no D0
    cycleDays,
    buildDays: span,
    coToClosingDays: days(co, cl),
  });
}

if (sample.length === 0) {
  console.error("Nenhuma obra fechada com lucro + 4 datas — nada a agregar.");
  process.exit(1);
}

const irrs = sample.map((s) => s.irr).filter((v) => v != null);
const floors = sample.map((s) => s.irrFloor);
const rois = sample.map((s) => s.roi);
const byYear = {};
for (const s of sample) byYear[s.year] = (byYear[s.year] ?? 0) + 1;
const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);

// fluxos combinados (TIR agregada do "portfólio" histórico)
const out = {
  source: path.basename(csvPath),
  extractDate: new Date().toISOString().slice(0, 10),
  basis: "total project cost (lot + construction)", // confirmado pelo Stefan 15/07/2026
  paymentPlanPct: TRIGGERS.map((t) => Math.round(t * 100)),
  export: {
    totalJobs: rows.length,
    prefixRange: `${Math.min(...prefixes)}–${Math.max(...prefixes)}`,
  },
  sample: {
    n: sample.length,
    criteria: "closed + realized net profit + complete permit/foundation/CO/closing dates",
    periodYears: `${years[0]}–${years[years.length - 1]}`,
    closingsByYear: byYear,
    holdingAdjusted,
  },
  roiPerCyclePct: {
    median: r1(median(rois) * 100),
    min: r1(Math.min(...rois) * 100),
    max: r1(Math.max(...rois) * 100),
  },
  cycle: {
    medianDays: Math.round(median(sample.map((s) => s.cycleDays))),
    buildMedianDays: Math.round(median(sample.map((s) => s.buildDays))),
    coToClosingMedianDays: Math.round(median(sample.map((s) => s.coToClosingDays))),
  },
  estimatedIrrPct: {
    median: r1(median(irrs) * 100),
    p25: r1(pctile(irrs, 0.25) * 100),
    p75: r1(pctile(irrs, 0.75) * 100),
    min: r1(Math.min(...irrs) * 100),
    above20: irrs.filter((v) => v >= 0.2).length,
    above28: irrs.filter((v) => v >= 0.28).length,
  },
  conservativeFloorIrrPct: {
    median: r1(median(floors) * 100),
    p25: r1(pctile(floors, 0.25) * 100),
    p75: r1(pctile(floors, 0.75) * 100),
    min: r1(Math.min(...floors) * 100),
  },
};

const outPath = path.join(import.meta.dirname, "..", "src", "data", "track-record.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`track-record.json: n=${out.sample.n} (${out.sample.periodYears}) · ROI mediano ${out.roiPerCyclePct.median}%/ciclo · TIR estimada mediana ${out.estimatedIrrPct.median}% · piso ${out.conservativeFloorIrrPct.median}% · holding ajustado em ${holdingAdjusted}`);
