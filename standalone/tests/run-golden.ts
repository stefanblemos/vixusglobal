// Golden tests: prova que ESTA cópia do motor reproduz a produção da Vixus AO CENTAVO.
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
      if (v !== got) errs.push(`kpis.${k}: esperado ${v}, veio ${got}`);
    } else if (!close(Number(got), Number(v), Math.abs(Number(v)) > 1 ? 0.01 : 1e-6)) {
      errs.push(`kpis.${k}: esperado ${v}, veio ${got}`);
    }
  }
  if (r.events.length !== expected.events.length)
    errs.push(`eventos: esperado ${expected.events.length}, veio ${r.events.length}`);
  else
    for (let i = 0; i < expected.events.length; i++) {
      const e = expected.events[i];
      const g = r.events[i];
      if (g.day !== e.day || g.kind !== e.kind || !close(g.amount, e.amount) || !close(g.cash, e.cash)) {
        errs.push(`evento #${i}: esperado ${JSON.stringify(e)}, veio dia ${g.day} ${g.kind} ${g.amount.toFixed(2)} caixa ${g.cash.toFixed(2)}`);
        break;
      }
    }
  if (errs.length) {
    failed++;
    console.error(`✗ ${name} (${f})`);
    for (const e of errs.slice(0, 5)) console.error(`    ${e}`);
  } else {
    console.log(`✓ ${name} — ${expected.events.length} eventos, TIR ${expected.kpis.irrAnnual == null ? "—" : (expected.kpis.irrAnnual * 100).toFixed(1) + "%"}`);
  }
}

if (failed) {
  console.error(`\n${failed}/${files.length} golden test(s) FALHARAM — a cópia divergiu da produção.`);
  process.exit(1);
}
console.log(`\nTodos os ${files.length} golden tests OK — motor idêntico à produção da Vixus.`);
