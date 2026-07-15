// Gera o pacote STANDALONE do simulador p/ o dev da 4U migrar à plataforma da 4U
// (pedido do Stefan 15/07: motor + catálogo + gerador de report, funcionando sozinho).
//
// Uso: node scripts/build-standalone.mjs
// Depois: scripts/export-premissas.ts (dados) e scripts/export-golden.ts (testes) — ambos
// contra o banco espelho de produção. Validação final: cd standalone && npm install && npm test
//
// FONTE ÚNICA: os arquivos copiados são os NÚCLEOS PUROS do app (sem Prisma) — quando o
// motor evoluir, rode este script de novo e re-exporte os goldens. Nada aqui é editado à
// mão dentro de standalone/src (seria sobrescrito).
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const OUT = path.join(ROOT, "standalone");

const COPIES = [
  ["src/lib/pools/simulator.ts", "src/simulator.ts"],
  ["src/lib/pools/build-input-core.ts", "src/build-input-core.ts"],
  ["src/lib/pools/phases.ts", "src/phases.ts"],
  ["src/lib/pools/benchmark.ts", "src/benchmark.ts"],
  ["src/lib/pools/report-data-core.ts", "src/report-data-core.ts"],
  ["src/lib/pools/report-docx.ts", "src/report-docx.ts"],
  ["src/lib/pools/report-logos.ts", "src/report-logos.ts"],
  ["src/lib/pools/report-ai-core.ts", "src/report-ai-core.ts"],
  ["src/data/market-stats.json", "data/market-stats.json"],
  ["src/data/track-record.json", "data/track-record.json"],
];

// Reescreve os imports do app p/ caminhos relativos do pacote (específicos primeiro)
function rewrite(src) {
  return src
    .replaceAll('from "@/lib/pools/report-data"', 'from "./report-data-core"')
    .replaceAll('from "@/lib/pools/report-ai"', 'from "./report-ai-core"')
    .replace(/from "@\/lib\/pools\/([^"]+)"/g, 'from "./$1"')
    .replace(/from "@\/data\/([^"]+)"/g, 'from "../data/$1"');
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, ".gitignore"), "node_modules/\nexamples/*.docx\n");
fs.mkdirSync(path.join(OUT, "src"), { recursive: true });
fs.mkdirSync(path.join(OUT, "data"), { recursive: true });
fs.mkdirSync(path.join(OUT, "sql"), { recursive: true });
fs.mkdirSync(path.join(OUT, "tests", "golden"), { recursive: true });
fs.mkdirSync(path.join(OUT, "examples"), { recursive: true });

for (const [from, to] of COPIES) {
  const raw = fs.readFileSync(path.join(ROOT, from), "utf8");
  const out = to.endsWith(".json") ? raw : rewrite(raw);
  fs.writeFileSync(path.join(OUT, to), out);
  console.log(`copiado: ${from} → standalone/${to}`);
}

fs.writeFileSync(
  path.join(OUT, "src", "index.ts"),
  `// API pública do simulador standalone (Vixus → plataforma 4U)
export { simulate } from "./simulator";
export type { SimInput, SimResult, SimUnitInput, SimUnitResult, SimBank, SimEvent } from "./simulator";
export {
  buildSimInputCore,
  comboKey,
  countOverrides,
} from "./build-input-core";
export type {
  CatalogData,
  CatalogScenarioData,
  CatalogComboData,
  CatalogBankData,
  CatalogVehicleCostData,
  SimFields,
  SimOverrides,
  UnitRef,
  PromoteTierInput,
} from "./build-input-core";
export { phasesOf, daysToMonths } from "./phases";
export { benchmarkOf } from "./benchmark";
export { assembleReportData } from "./report-data-core";
export type { ReportData, ReportModelInfo, ReportSimMeta, ScenarioKpis } from "./report-data-core";
export { buildReportDocx } from "./report-docx";
export type { ReportLang } from "./report-docx";
// Prosa da IA (opcional — precisa de @anthropic-ai/sdk + zod + ANTHROPIC_API_KEY):
// importe direto de "./report-ai-core" para não carregar as deps opcionais à toa.
`,
);

fs.writeFileSync(
  path.join(OUT, "package.json"),
  JSON.stringify(
    {
      name: "vixus-simulator",
      version: "1.0.0",
      description:
        "Simulador de pools build-to-sell (motor + catálogo + gerador de Investment Summary) — pacote standalone da Vixus para a plataforma 4U",
      type: "module",
      main: "src/index.ts",
      scripts: {
        test: "tsx tests/run-golden.ts",
        "example:sim": "tsx examples/run-simulation.ts",
        "example:report": "tsx examples/generate-report.ts",
        typecheck: "tsc --noEmit",
      },
      dependencies: {
        docx: "^9.7.1",
      },
      // prosa da IA é opt-in (import direto de src/report-ai-core) — mesmas versões do app
      optionalDependencies: {
        "@anthropic-ai/sdk": "^0.104.1",
        zod: "^4.4.3",
      },
      devDependencies: {
        tsx: "^4.19.0",
        typescript: "^5.6.0",
        "@types/node": "^22.0.0",
      },
    },
    null,
    2,
  ) + "\n",
);

fs.writeFileSync(
  path.join(OUT, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        esModuleInterop: true,
        resolveJsonModule: true,
        skipLibCheck: true,
        types: ["node"],
      },
      include: ["src/**/*.ts", "tests/**/*.ts", "examples/**/*.ts"],
    },
    null,
    2,
  ) + "\n",
);

fs.writeFileSync(
  path.join(OUT, "tests", "run-golden.ts"),
  `// Golden tests: prova que ESTA cópia do motor reproduz a produção da Vixus AO CENTAVO.
// Cada caso carrega um SimInput real congelado + o resultado esperado (kpis + eventos).
// Rode após qualquer mudança no motor: npm test
import fs from "node:fs";
import path from "node:path";
import { simulate } from "../src/simulator";

const dir = path.join(import.meta.dirname, "golden");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
if (files.length === 0) {
  console.error("Nenhum golden test em tests/golden/ — rode scripts/export-golden.ts no repo da Vixus.");
  process.exit(1);
}

const close = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;
let failed = 0;

for (const f of files) {
  const { name, input, expected } = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const r = simulate(input);
  const errs: string[] = [];
  for (const [k, v] of Object.entries(expected.kpis)) {
    const got = (r.kpis as Record<string, number | null>)[k];
    if (v == null || got == null) {
      if (v !== got) errs.push(\`kpis.\${k}: esperado \${v}, veio \${got}\`);
    } else if (!close(Number(got), Number(v), Math.abs(Number(v)) > 1 ? 0.01 : 1e-6)) {
      errs.push(\`kpis.\${k}: esperado \${v}, veio \${got}\`);
    }
  }
  if (r.events.length !== expected.events.length)
    errs.push(\`eventos: esperado \${expected.events.length}, veio \${r.events.length}\`);
  else
    for (let i = 0; i < expected.events.length; i++) {
      const e = expected.events[i];
      const g = r.events[i];
      if (g.day !== e.day || g.kind !== e.kind || !close(g.amount, e.amount) || !close(g.cash, e.cash)) {
        errs.push(\`evento #\${i}: esperado \${JSON.stringify(e)}, veio dia \${g.day} \${g.kind} \${g.amount.toFixed(2)} caixa \${g.cash.toFixed(2)}\`);
        break;
      }
    }
  if (errs.length) {
    failed++;
    console.error(\`✗ \${name} (\${f})\`);
    for (const e of errs.slice(0, 5)) console.error(\`    \${e}\`);
  } else {
    console.log(\`✓ \${name} — \${expected.events.length} eventos, TIR \${expected.kpis.irrAnnual == null ? "—" : (expected.kpis.irrAnnual * 100).toFixed(1) + "%"}\`);
  }
}

if (failed) {
  console.error(\`\\n\${failed}/\${files.length} golden test(s) FALHARAM — a cópia divergiu da produção.\`);
  process.exit(1);
}
console.log(\`\\nTodos os \${files.length} golden tests OK — motor idêntico à produção da Vixus.\`);
`,
);

fs.writeFileSync(
  path.join(OUT, "examples", "run-simulation.ts"),
  `// Exemplo mínimo: monta o SimInput com buildSimInputCore (catálogo em JSON) e roda o motor.
// As premissas reais (cenários/fees/bancos/waterfall/custos de veículo) estão em
// data/premissas.json — locations/modelos vêm do SEU banco (a 4U já os tem).
import fs from "node:fs";
import path from "node:path";
import { buildSimInputCore, simulate, type CatalogData } from "../src/index";

const premissas = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "..", "data", "premissas.json"), "utf8"),
);

const scenario = premissas.scenarios.find((s: { code: string }) => s.code === "REAL");

// Combinação modelo×location de exemplo — na integração real, monte a partir do seu banco
const catalog: CatalogData = {
  scenario,
  combos: [
    {
      modelId: "m1",
      locationId: "l1",
      modelName: "Oakview Ranch",
      locationName: "Rainbow Lakes",
      houseType: "AFFORDABLE",
      buildMonths: 4,
      contractorFeeOverride: null,
      salePrice: 310000,
      costPerformance: 205000,
      costContractor: 190000,
      costOpenBook: 185000,
      permitDays: 45,
      lotLeadDays: 25,
      saleDays: 60,
      lotCostEstimate: 40000,
    },
  ],
  houseTypeFees: premissas.houseTypeFees,
  bank: null, // equity — para banco, use um perfil de premissas.banks
  vehicleCosts: premissas.vehicleCosts,
};

const input = buildSimInputCore(
  {
    fundingMode: "EQUITY",
    compMode: "CONTRACTOR_FEE",
    perfPct: 35,
    perfTiming: "PROJECT_COMPLETION",
    promoteTiers: premissas.waterfallTiers,
    flatFeePerHouse: 0,
    paymentPlan: "STANDARD",
    equityGatePct: 100,
    unitGapDays: scenario.unitGapDays,
    scenarioCode: "REAL",
    bankProfileId: null,
    units: [{ locationId: "l1", modelId: "m1" }],
    overrides: null,
    vehicleStructure: "VIXUS_MANAGED",
  },
  catalog,
);
if ("error" in input) throw new Error(input.error);

const r = simulate(input);
console.log("KPIs:", {
  irrAnnual: r.kpis.irrAnnual,
  profit: r.kpis.profit,
  peakCapital: r.kpis.peakCapital,
  durationDays: r.kpis.durationDays,
});
console.log(\`Eventos no ledger: \${r.events.length}\`);
`,
);

fs.writeFileSync(
  path.join(OUT, "examples", "generate-report.ts"),
  `// Exemplo: gera o Investment Summary (DOCX) a partir de um golden case real.
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
const out = path.join(import.meta.dirname, \`example-report-\${lang}.docx\`);
fs.writeFileSync(out, buf);
console.log(\`DOCX gerado: \${out} (\${(buf.byteLength / 1024).toFixed(0)} KB)\`);
`,
);

fs.writeFileSync(
  path.join(OUT, "README.md"),
  `# Vixus Simulator — pacote standalone (para a plataforma 4U)

Motor de simulação de pools build-to-sell + gerador do Investment Summary (DOCX),
extraído da plataforma Vixus para migração à plataforma da 4U. **Sem banco, sem
framework** — TypeScript puro (Node ≥ 20), única dependência de runtime: \`docx\`.

## Rodar

\`\`\`bash
npm install
npm test              # golden tests: prova que a cópia bate com a produção AO CENTAVO
npm run example:sim   # simulação mínima via buildSimInputCore + simulate
npm run example:report        # Investment Summary DOCX (inglês)
npx tsx examples/generate-report.ts pt   # ou es
\`\`\`

## O que tem aqui

| Pasta | Conteúdo |
| --- | --- |
| \`src/simulator.ts\` | O motor: cronograma (busca→caução→escrow→closing→permit→obra→CO→venda), esteira de ciclos ("vendeu uma, começa uma"), tesouraria just-in-time, banco linha a linha (LTC/LTV, fees, interest reserve, extension), waterfall do developer, custos de veículo. Função pura: \`simulate(SimInput) → SimResult\`. |
| \`src/build-input-core.ts\` | Monta o \`SimInput\` a partir do catálogo (\`buildSimInputCore(simFields, catalog)\`). Aplica overrides por simulação (aba Premissas) e buffers de cenário. |
| \`src/report-data-core.ts\` | Monta o \`ReportData\` (3 cenários + sensibilidade + breakeven + fechamento ao centavo + fases + benchmark + ficha de modelos) a partir de cenários já rodados: \`assembleReportData(meta, runs, models)\`. |
| \`src/report-docx.ts\` | O Investment Summary canônico (DOCX) em **EN/PT-BR/ES**: \`buildReportDocx(data, recipient?, prose?, lang?)\`. |
| \`src/report-ai-core.ts\` | (Opcional) prosa viva do report via Claude — requer \`ANTHROPIC_API_KEY\` e as deps opcionais. Sem ela, o DOCX sai sem as 2 seções de IA (fallback previsto). |
| \`src/phases.ts\` / \`src/benchmark.ts\` | Fases segmentadas do projeto (Gantt/§5) e benchmark premissas × vendidos do ATTOM (§3). |
| \`data/premissas.json\` | **Os dados que a 4U não tem**: cenários (Ótimo/Real/Conservador), fees por tipo de casa, perfis de banco (com custom fees), waterfall default e custos de veículo — export da produção da Vixus. Locations/modelos vocês já têm no banco de vocês. |
| \`data/market-stats.json\` | Extrato semanal do ATTOM (tabela §3 + distribuições do benchmark). Atualizado semanalmente pela Vixus — substituir o arquivo. |
| \`data/track-record.json\` | Agregados do histórico da 4U (§2 do report). |
| \`sql/catalog-schema.sql\` | DDL de referência das tabelas de catálogo (PostgreSQL) — para mapear os campos com o banco da 4U. |
| \`tests/golden/\` | Casos reais congelados (SimInput + resultado esperado). **É o contrato**: se \`npm test\` passa, a migração está fiel. |

## Contrato de integração (o caminho feliz)

1. Monte o \`CatalogData\` com dados do SEU banco (combos modelo×location) + \`premissas.json\`.
2. \`buildSimInputCore(simFields, catalog)\` → \`SimInput\` (ou \`{error}\` com mensagem pronta p/ UI).
3. \`simulate(input)\` → KPIs + ledger de eventos datados (D+n).
4. Para o report: rode os 3 cenários (REAL/CONS/OPT), \`assembleReportData(...)\` e
   \`buildReportDocx(data, destinatário?, prose?, "en"|"pt"|"es")\` → \`Packer.toBuffer\`.

## Regras importantes (não mudar sem falar com a Vixus)

- **Fechamento ao centavo**: \`closing.diff\` tem que ser 0.00 — o app da Vixus bloqueia a
  emissão do report se não for. Recomendamos manter o mesmo guard.
- Dinheiro em **dólares float com arredondamento 2dp nos eventos** (mesma matemática dos
  goldens); dias são inteiros D+n a partir do início do programa.
- O gap do cenário espaça as **CAUÇÕES de lote** (não o início das buscas); ciclos ≥ 2 são
  disparados pelas vendas do ciclo anterior.
- A extension fee do banco só se aplica no cenário Conservador (\`applyExtensionFee\`).

## Origem e atualizações

Este pacote é GERADO do repositório da Vixus (\`scripts/build-standalone.mjs\` +
\`export-premissas.ts\` + \`export-golden.ts\`). Correções de motor acontecem lá e o pacote é
re-gerado — não edite \`src/\` diretamente, ou a próxima atualização sobrescreve.
`,
);

console.log("\nstandalone/ gerado. Próximos passos: export-premissas.ts, export-golden.ts, npm install && npm test");
