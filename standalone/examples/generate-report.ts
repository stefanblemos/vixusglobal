// Exemplo: gera o Investment Summary (DOCX) a partir de um golden case real.
// Idioma via argumento: tsx examples/generate-report.ts [en|pt|es]
import fs from "node:fs";
import path from "node:path";
import { Packer } from "docx";
import { simulate } from "../src/simulator";
import { assembleReportData } from "../src/report-data-core";
import { buildReportDocx, type ReportLang } from "../src/report-docx";

const lang = (["en", "pt", "es"].includes(process.argv[2] ?? "") ? process.argv[2] : "en") as ReportLang;
const goldenDir = path.join(import.meta.dirname, "..", "tests", "golden");
const files = fs.readdirSync(goldenDir).filter((f) => f.endsWith(".json"));

// Para o report são precisos os 3 cenários — usa os goldens do mesmo projeto (PH7)
const runs = files
  .filter((f) => f.startsWith("ph7-"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(goldenDir, f), "utf8")))
  .map((g: { scenarioCode: string; scenarioName: string; input: Parameters<typeof simulate>[0] }) => ({
    code: g.scenarioCode,
    name: g.scenarioName,
    input: g.input,
    result: simulate(g.input),
  }));

const data = assembleReportData(
  {
    name: "PH7 (exemplo standalone)",
    generatedAt: new Date().toISOString().slice(0, 10),
    fundingMode: runs[0].input.fundingMode,
    vehicleStructure: "VIXUS_MANAGED",
    clientEntityName: null,
    vehicleEntityName: "VHP VII LLC",
    waiveFormationCost: false,
    compMode: runs[0].input.compMode,
    perfPct: runs[0].input.perfPct * 100,
    perfTiming: runs[0].input.perfTiming,
    promoteTiers: runs[0].input.promoteTiers,
    flatFeePerHouse: runs[0].input.flatFeePerHouse,
    bankName: null,
    bankTerms: null,
    bankTermMonths: null,
    overrides: null,
    basketModelIds: [], // sem fotos no exemplo — a ficha de modelos simplesmente não aparece
  },
  runs,
  [],
);
if ("error" in data) throw new Error(data.error);

const buf = await Packer.toBuffer(buildReportDocx(data, undefined, null, lang));
const out = path.join(import.meta.dirname, `example-report-${lang}.docx`);
fs.writeFileSync(out, buf);
console.log(`DOCX gerado: ${out} (${(buf.byteLength / 1024).toFixed(0)} KB)`);
