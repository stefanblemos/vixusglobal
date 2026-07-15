# Vixus Simulator — pacote standalone (para a plataforma 4U)

Motor de simulação de pools build-to-sell + gerador do Investment Summary (DOCX),
extraído da plataforma Vixus para migração à plataforma da 4U. **Sem banco, sem
framework** — TypeScript puro (Node ≥ 20), única dependência de runtime: `docx`.

## Rodar

```bash
npm install
npm test              # golden tests: prova que a cópia bate com a produção AO CENTAVO
npm run example:sim   # simulação mínima via buildSimInputCore + simulate
npm run example:report        # Investment Summary DOCX (inglês)
npx tsx examples/generate-report.ts pt   # ou es
```

## O que tem aqui

| Pasta | Conteúdo |
| --- | --- |
| `src/simulator.ts` | O motor: cronograma (busca→caução→escrow→closing→permit→obra→CO→venda), esteira de ciclos ("vendeu uma, começa uma"), tesouraria just-in-time, banco linha a linha (LTC/LTV, fees, interest reserve, extension), waterfall do developer, custos de veículo. Função pura: `simulate(SimInput) → SimResult`. |
| `src/build-input-core.ts` | Monta o `SimInput` a partir do catálogo (`buildSimInputCore(simFields, catalog)`). Aplica overrides por simulação (aba Premissas) e buffers de cenário. |
| `src/report-data-core.ts` | Monta o `ReportData` (3 cenários + sensibilidade + breakeven + fechamento ao centavo + fases + benchmark + ficha de modelos) a partir de cenários já rodados: `assembleReportData(meta, runs, models)`. |
| `src/report-docx.ts` | O Investment Summary canônico (DOCX) em **EN/PT-BR/ES**: `buildReportDocx(data, recipient?, prose?, lang?)`. |
| `src/report-ai-core.ts` | (Opcional) prosa viva do report via Claude — requer `ANTHROPIC_API_KEY` e as deps opcionais. Sem ela, o DOCX sai sem as 2 seções de IA (fallback previsto). |
| `src/phases.ts` / `src/benchmark.ts` | Fases segmentadas do projeto (Gantt/§5) e benchmark premissas × vendidos do ATTOM (§3). |
| `data/premissas.json` | **Os dados que a 4U não tem**: cenários (Ótimo/Real/Conservador), fees por tipo de casa, perfis de banco (com custom fees), waterfall default e custos de veículo — export da produção da Vixus. Locations/modelos vocês já têm no banco de vocês. |
| `data/market-stats.json` | Extrato semanal do ATTOM (tabela §3 + distribuições do benchmark). Atualizado semanalmente pela Vixus — substituir o arquivo. |
| `data/track-record.json` | Agregados do histórico da 4U (§2 do report). |
| `sql/catalog-schema.sql` | DDL de referência das tabelas de catálogo (PostgreSQL) — para mapear os campos com o banco da 4U. |
| `tests/golden/` | Casos reais congelados (SimInput + resultado esperado). **É o contrato**: se `npm test` passa, a migração está fiel. |

## Contrato de integração (o caminho feliz)

1. Monte o `CatalogData` com dados do SEU banco (combos modelo×location) + `premissas.json`.
2. `buildSimInputCore(simFields, catalog)` → `SimInput` (ou `{error}` com mensagem pronta p/ UI).
3. `simulate(input)` → KPIs + ledger de eventos datados (D+n).
4. Para o report: rode os 3 cenários (REAL/CONS/OPT), `assembleReportData(...)` e
   `buildReportDocx(data, destinatário?, prose?, "en"|"pt"|"es")` → `Packer.toBuffer`.

## Regras importantes (não mudar sem falar com a Vixus)

- **Fechamento ao centavo**: `closing.diff` tem que ser 0.00 — o app da Vixus bloqueia a
  emissão do report se não for. Recomendamos manter o mesmo guard.
- Dinheiro em **dólares float com arredondamento 2dp nos eventos** (mesma matemática dos
  goldens); dias são inteiros D+n a partir do início do programa.
- O gap do cenário espaça as **CAUÇÕES de lote** (não o início das buscas); ciclos ≥ 2 são
  disparados pelas vendas do ciclo anterior.
- A extension fee do banco só se aplica no cenário Conservador (`applyExtensionFee`).

## Origem e atualizações

Este pacote é GERADO do repositório da Vixus (`scripts/build-standalone.mjs` +
`export-premissas.ts` + `export-golden.ts`). Correções de motor acontecem lá e o pacote é
re-gerado — não edite `src/` diretamente, ou a próxima atualização sobrescreve.
