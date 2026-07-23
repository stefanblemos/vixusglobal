"use client";

import { useState, useTransition } from "react";
import {
  optimizeProgramAction,
  evaluateProgramAction,
  saveOptimizedSimulation,
  type OptimizerPayloadSettings,
} from "@/lib/actions/optimizer";
import type { BasketLine, ComboEcon, CycleBreakdown, ProgramKpis } from "@/lib/pools/optimizer";

type Loc = { id: string; name: string };
type Bank = { id: string; name: string };
type Scenario = { code: string; name: string };

const money = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const compact = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : money(v));
const pct = (v: number | null) =>
  v == null || v <= -0.5 ? "n/s" : `${(v * 100).toFixed(1)}%`;

const lineKey = (l: { locationId: string; modelId: string }) => `${l.locationId}|${l.modelId}`;

export function ProgramOptimizerModal({
  locations,
  banks,
  scenarios,
  defaultBankId,
  poolId = null,
}: {
  locations: Loc[];
  banks: Bank[];
  scenarios: Scenario[];
  defaultBankId: string | null;
  poolId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-[#1f3a5f] px-4 py-2 text-sm font-medium text-[#1f3a5f] hover:bg-[#1f3a5f]/5"
      >
        🎯 Montar pelo alvo
      </button>
      {open && (
        <Modal
          locations={locations}
          banks={banks}
          scenarios={scenarios}
          defaultBankId={defaultBankId}
          poolId={poolId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Modal({
  locations,
  banks,
  scenarios,
  defaultBankId,
  poolId,
  onClose,
}: {
  locations: Loc[];
  banks: Bank[];
  scenarios: Scenario[];
  defaultBankId: string | null;
  poolId: string | null;
  onClose: () => void;
}) {
  // entradas
  const [equity, setEquity] = useState(5_000_000);
  const [horizon, setHorizon] = useState(30);
  const [share, setShare] = useState(8);
  const [diversity, setDiversity] = useState<"CONCENTRATE" | "BALANCE" | "SPREAD">("BALANCE");
  const [picked, setPicked] = useState<Record<string, boolean>>(
    Object.fromEntries(locations.map((l) => [l.id, true])),
  );
  const [fundingMode, setFundingMode] = useState<"EQUITY" | "BANK">("EQUITY");
  const [bankId, setBankId] = useState(defaultBankId ?? banks[0]?.id ?? "");
  const [scenarioCode, setScenarioCode] = useState(
    scenarios.find((s) => s.code === "REAL")?.code ?? scenarios[0]?.code ?? "REAL",
  );
  const [perfPct, setPerfPct] = useState(35);
  const [name, setName] = useState("");

  // resultado
  const [lines, setLines] = useState<BasketLine[] | null>(null);
  const [econ, setEcon] = useState<ComboEcon[]>([]);
  const [kpis, setKpis] = useState<ProgramKpis | null>(null);
  const [cycles, setCycles] = useState<CycleBreakdown[]>([]);
  const [peak, setPeak] = useState(0);
  const [bankCommitted, setBankCommitted] = useState(0);
  const [durationMonths, setDurationMonths] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [recalcing, setRecalcing] = useState(false);

  const settings = (): OptimizerPayloadSettings => ({
    fundingMode,
    bankProfileId: fundingMode === "BANK" ? bankId || null : null,
    scenarioCode,
    compMode: "PERFORMANCE",
    perfPct,
    perfTiming: "PROJECT_COMPLETION",
    promoteTiers: null,
    paymentPlan: "STANDARD",
    equityGatePct: 10,
    unitGapDays: 3,
    flatFeePerHouse: 0,
    vehicleStructure: "VIXUS_MANAGED",
    waiveFormationCost: false,
  });

  function optimize() {
    setError(null);
    const locationIds = locations.filter((l) => picked[l.id]).map((l) => l.id);
    startTransition(async () => {
      const r = await optimizeProgramAction({
        equityTarget: equity,
        horizonMonths: horizon,
        locationIds,
        sharePct: share,
        diversity,
        settings: settings(),
      });
      if (!("lines" in r)) {
        setError(r.error);
        return;
      }
      setLines(r.lines);
      setEcon(r.econ);
      setKpis(r.kpis);
      setCycles(r.cycles);
      setPeak(r.peak);
      setBankCommitted(r.bankCommitted);
      setDurationMonths(r.durationMonths);
      setWarnings(r.warnings);
    });
  }

  // Recalcula a cesta editada pelo motor real (mantendo as premissas)
  function recalc(next: BasketLine[]) {
    const reflagged = next.map((l) => ({ ...l, over: l.cap != null && l.cycle1 > l.cap }));
    setLines(reflagged);
    setRecalcing(true);
    startTransition(async () => {
      const r = await evaluateProgramAction({ lines: reflagged, settings: settings() });
      setRecalcing(false);
      if (r.error) {
        setError(r.error ?? "Erro ao recalcular.");
        return;
      }
      setKpis(r.kpis);
      setCycles(r.cycles);
      setPeak(r.peak);
      setBankCommitted(r.bankCommitted);
      setDurationMonths(r.durationMonths);
    });
  }

  function setQty(key: string, delta: number) {
    if (!lines) return;
    recalc(
      lines.map((l) => (lineKey(l) === key ? { ...l, cycle1: Math.max(0, l.cycle1 + delta) } : l)),
    );
  }

  function swapModel(key: string, modelId: string) {
    if (!lines) return;
    const l0 = lines.find((l) => lineKey(l) === key);
    if (!l0) return;
    const e = econ.find((c) => c.locationId === l0.locationId && c.modelId === modelId);
    if (!e) return;
    const swapped: BasketLine = {
      locationId: e.locationId, modelId: e.modelId, locationName: e.locationName, modelName: e.modelName,
      cycle1: l0.cycle1, cycles: l0.cycles, over: false, cap: e.cap, source: e.source,
      perYear: e.perYear, eqUnit: e.eqUnit, bankUnit: e.bankUnit, profitUnit: e.profitUnit, cycleDays: e.cycleDays,
    };
    recalc(lines.map((l) => (lineKey(l) === key ? swapped : l)));
  }

  function save() {
    if (!lines) return;
    const units = lines.flatMap((l) =>
      l.cycle1 <= 0
        ? []
        : Array.from({ length: l.cycles }, (_, c) =>
            Array.from({ length: l.cycle1 }, () => ({ locationId: l.locationId, modelId: l.modelId, cycle: c + 1 })),
          ).flat(),
    );
    startTransition(async () => {
      const r = await saveOptimizedSimulation({
        name: name.trim() || `Programa ${money(equity)} · ${horizon}m`,
        poolId,
        units,
        settings: settings(),
      });
      if (r && "error" in r) setError(r.error);
      // sucesso → a action redireciona para a simulação criada
    });
  }

  const useFrac = equity > 0 ? Math.min(1, peak / equity) : 0;
  const kept = (lines ?? []).filter((l) => l.cycle1 > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className="w-full max-w-5xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎯</span>
            <div>
              <h3 className="text-lg font-semibold text-slate-800">Montar programa pelo alvo</h3>
              <p className="text-xs text-slate-400">
                O otimizador busca a cesta de maior TIR consumindo o equity, medida pelo motor real.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {/* ENTRADAS */}
        <div className="grid grid-cols-2 gap-4 border-b border-slate-100 px-6 py-4 md:grid-cols-4">
          <Field label="Equity do grupo">
            <input
              type="number" step={250000} value={equity}
              onChange={(e) => setEquity(Number(e.target.value) || 0)}
              className={input}
            />
          </Field>
          <Field label="Horizonte (meses)">
            <input
              type="number" step={3} value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value) || 0)}
              className={input}
            />
          </Field>
          <Field label="Participação de mercado (%)" hint="quanto do mesmo modelo por local">
            <input
              type="number" step={1} value={share}
              onChange={(e) => setShare(Number(e.target.value) || 0)}
              className={input}
            />
          </Field>
          <Field label="Performance da 4U (%)">
            <input
              type="number" step={1} value={perfPct}
              onChange={(e) => setPerfPct(Number(e.target.value) || 0)}
              className={input}
            />
          </Field>
          <Field
            label="Distribuição"
            hint={
              diversity === "CONCENTRATE" ? "máx TIR — pode concentrar num modelo"
                : diversity === "SPREAD" ? "espalha modelos e locais (menos TIR)"
                : "equilibra mix e retorno"
            }
          >
            <div className="flex overflow-hidden rounded-lg border border-slate-300">
              {([["CONCENTRATE", "Concentrar"], ["BALANCE", "Equilibrar"], ["SPREAD", "Espalhar"]] as const).map(
                ([v, lbl]) => (
                  <button
                    key={v}
                    onClick={() => setDiversity(v)}
                    className={`flex-1 px-1.5 py-2 text-xs ${
                      diversity === v ? "bg-[#1f3a5f] text-white" : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {lbl}
                  </button>
                ),
              )}
            </div>
          </Field>
          <Field
            label="Capital"
            hint={fundingMode === "EQUITY" ? "esteira: recicla o capital do grupo" : "leva alavancada: 1 LLC/loan"}
          >
            <div className="flex overflow-hidden rounded-lg border border-slate-300">
              {(["EQUITY", "BANK"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setFundingMode(m)}
                  className={`flex-1 px-2 py-2 text-xs ${
                    fundingMode === m ? "bg-[#1f3a5f] text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {m === "EQUITY" ? "Equity" : "Banco"}
                </button>
              ))}
            </div>
          </Field>
          {fundingMode === "BANK" && (
            <Field label="Banco">
              <select value={bankId} onChange={(e) => setBankId(e.target.value)} className={input}>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Cenário">
            <select value={scenarioCode} onChange={(e) => setScenarioCode(e.target.value)} className={input}>
              {scenarios.map((s) => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
            </select>
          </Field>
          <div className="col-span-2 md:col-span-2">
            <label className={labelCls}>Locais elegíveis</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {locations.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setPicked((p) => ({ ...p, [l.id]: !p[l.id] }))}
                  className={`rounded-full px-3 py-1 text-xs ${
                    picked[l.id]
                      ? "border border-[#1f3a5f] bg-[#1f3a5f]/10 text-[#1f3a5f]"
                      : "border border-slate-200 text-slate-400"
                  }`}
                >
                  {l.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="px-6 pt-3 text-sm text-red-600">{error}</p>}

        {!lines ? (
          <div className="flex items-center justify-between px-6 py-5">
            <p className="text-sm text-slate-500">
              Defina o alvo e clique para o otimizador montar a cesta.
            </p>
            <button
              onClick={optimize}
              disabled={pending}
              className="rounded-lg bg-[#1f3a5f] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
            >
              {pending ? "Buscando…" : "Buscar cesta ótima"}
            </button>
          </div>
        ) : (
          <>
            {/* RESULTADO — duas telas */}
            <div className="grid gap-4 px-6 py-4 md:grid-cols-2">
              {/* Esquerda: KPIs + cesta */}
              <div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Equity no pico</span>
                    <span>{(useFrac * 100).toFixed(0)}% do alvo gasto</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded bg-slate-200">
                    <div
                      className="h-2 rounded"
                      style={{
                        width: `${(useFrac * 100).toFixed(0)}%`,
                        background: useFrac >= 0.98 ? "#059669" : "#1f3a5f",
                      }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span className="font-medium">{compact(peak)} equity</span>
                    <span className="text-slate-500">+ banco <b className="text-slate-800">{compact(bankCommitted)}</b></span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Kpi label="TIR" value={pct(kpis?.irrAnnual ?? null)} accent />
                    <Kpi label="Lucro grupo" value={compact(kpis?.profit ?? 0)} />
                    <Kpi label="Prazo" value={`${durationMonths}m`} />
                  </div>
                </div>

                {warnings.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {warnings.map((w, i) => (
                      <p key={i} className="flex items-start gap-1 text-xs text-amber-700">
                        <span>⚠</span>
                        <span>{w}</span>
                      </p>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                  <span>Cesta — edite quantidade ou troque o modelo</span>
                  {recalcing && <span className="text-slate-400">recalculando…</span>}
                </div>
                <div className="mt-1 max-h-72 space-y-1 overflow-y-auto pr-1">
                  {kept.map((l) => {
                    const key = lineKey(l);
                    const models = econ.filter((c) => c.locationId === l.locationId);
                    return (
                      <div key={key} className="flex items-center gap-2 border-b border-slate-50 py-1.5 text-xs">
                        <div className="w-24 shrink-0">
                          <div className="font-medium text-slate-700">{l.locationName}</div>
                          <div className={l.over ? "text-amber-600" : "text-slate-400"}>
                            {l.over ? `⚠ máx ${l.cap} (${l.source})` : l.source === "NONE" ? "sem absorção" : `máx ${l.cap ?? "—"}`}
                          </div>
                          <div className="text-slate-400">eq {compact(l.eqUnit)} · banco {compact(l.bankUnit)}</div>
                        </div>
                        <select
                          value={l.modelId}
                          onChange={(e) => swapModel(key, e.target.value)}
                          className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1"
                        >
                          {models.map((m) => (
                            <option key={m.modelId} value={m.modelId}>{m.modelName}</option>
                          ))}
                        </select>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setQty(key, -1)} className={qtyBtn}>−</button>
                          <span className={`w-5 text-center font-medium ${l.over ? "text-amber-600" : ""}`}>{l.cycle1}</span>
                          <button onClick={() => setQty(key, 1)} className={qtyBtn}>+</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Direita: ciclos */}
              <div>
                <div className="text-sm font-medium text-slate-700">Ciclos da esteira</div>
                <div className="text-xs text-slate-400">{cycles.length} ondas · o equity gira e reinveste</div>
                <div className="mt-2 max-h-96 space-y-2 overflow-y-auto pr-1">
                  {cycles.map((c) => {
                    const maxN = Math.max(1, ...cycles.map((x) => x.houses));
                    return (
                      <div key={c.cycle} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs font-medium text-slate-600">Ciclo {c.cycle}</span>
                          <span className="text-sm font-medium">
                            {c.houses} casas <span className="text-xs font-normal text-slate-400">· eq {compact(c.equityWave)}</span>
                          </span>
                        </div>
                        <div className="my-1.5 h-1 rounded bg-slate-200">
                          <div className="h-1 rounded bg-[#1f3a5f]" style={{ width: `${(c.houses / maxN) * 100}%` }} />
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {c.items.map((it, i) => (
                            <span
                              key={i}
                              className={`rounded-full px-2 py-0.5 text-[11px] ${
                                it.over ? "bg-amber-100 text-amber-700" : "bg-[#1f3a5f]/10 text-[#1f3a5f]"
                              }`}
                            >
                              {it.locationName.split(" ")[0]}·{it.modelName} ×{it.qty}{it.over ? " ⚠" : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Rodapé */}
            <div className="flex items-center gap-3 border-t border-slate-100 px-6 py-4">
              <button onClick={() => setLines(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
                ↺ Reotimizar
              </button>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome do programa"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={pending || kept.length === 0}
                className="rounded-lg bg-[#1f3a5f] px-5 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
              >
                {pending ? "Salvando…" : "Fechar e salvar simulação →"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelCls = "block text-xs font-medium text-slate-600";
const qtyBtn = "flex h-6 w-6 items-center justify-center rounded border border-slate-300 text-slate-600 hover:bg-slate-100";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-base font-medium ${accent ? "text-[#1f3a5f]" : "text-slate-800"}`}>{value}</div>
    </div>
  );
}
