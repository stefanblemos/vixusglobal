"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { updateSimulationSettings, type FormState } from "@/lib/actions/simulations";

const labelClass = "mb-1 block text-xs text-slate-400";
const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f]";

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
      {options.map(([v, label], i) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`px-3 py-2 text-sm transition ${i > 0 ? "border-l border-slate-200" : ""} ${
            value === v
              ? "bg-[#1f3a5f] font-medium text-white"
              : "bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Alavancas da simulação "viva": cenário, funding e remuneração recalculam na hora
// (sobrescreve o snapshot — para guardar uma versão, duplique a simulação).
// IMPORTANTE: montar com key derivada dos valores salvos (a página faz isso) — o React 19
// reseta o form após cada action e dessincroniza selects controlados; a remontagem pós-
// sucesso realinha a tela com o banco. Erros da action (ex.: catálogo incompleto p/ open
// book) aparecem abaixo dos controles em vez de falhar em silêncio.
export function SimulationControls({
  sim,
  scenarios,
  banks,
}: {
  sim: {
    id: string;
    scenarioCode: string;
    fundingMode: string;
    bankProfileId: string | null;
    compMode: string;
    perfPct: string;
    perfTiming: string;
    flatFeePerHouse: string;
  };
  scenarios: Array<{ code: string; name: string }>;
  banks: Array<{ id: string; name: string }>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateSimulationSettings,
    undefined,
  );
  const [scenarioCode, setScenarioCode] = useState(sim.scenarioCode);
  const [fundingMode, setFundingMode] = useState(sim.fundingMode);
  const [bankProfileId, setBankProfileId] = useState(sim.bankProfileId ?? banks[0]?.id ?? "");
  const [compMode, setCompMode] = useState(sim.compMode);
  const [perfPct, setPerfPct] = useState(sim.perfPct);
  const [perfTiming, setPerfTiming] = useState(sim.perfTiming);
  const [flatFee, setFlatFee] = useState(sim.flatFeePerHouse);

  // Se a action falhou, os valores salvos NÃO mudaram — realinha os selects com o banco
  // para a tela não mentir (o form reset do React já bagunçou o DOM a essa altura).
  useEffect(() => {
    if (state?.error) {
      setScenarioCode(sim.scenarioCode);
      setFundingMode(sim.fundingMode);
      setBankProfileId(sim.bankProfileId ?? banks[0]?.id ?? "");
      setCompMode(sim.compMode);
      setPerfPct(sim.perfPct);
      setPerfTiming(sim.perfTiming);
      setFlatFee(sim.flatFeePerHouse);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // setTimeout (não rAF): dispara após o flush do estado e funciona mesmo em aba oculta
  const submit = () => setTimeout(() => formRef.current?.requestSubmit(), 0);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="rounded-xl border border-slate-200 bg-white px-5 py-4"
    >
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <input type="hidden" name="simulationId" value={sim.id} />
        <input type="hidden" name="scenarioCode" value={scenarioCode} />
        <input type="hidden" name="fundingMode" value={fundingMode} />
        <input type="hidden" name="compMode" value={compMode} />
        <input type="hidden" name="perfPct" value={perfPct} />
        <input type="hidden" name="perfTiming" value={perfTiming} />
        <input type="hidden" name="flatFeePerHouse" value={flatFee} />

        <div>
          <span className={labelClass}>Cenário</span>
          <Segmented
            value={scenarioCode}
            options={scenarios.map((s) => [s.code, s.name])}
            onChange={(v) => {
              setScenarioCode(v);
              submit();
            }}
          />
        </div>

        <div>
          <span className={labelClass}>Funding</span>
          <div className="flex items-center gap-2">
            <Segmented
              value={fundingMode}
              options={[
                ["EQUITY", "Equity"],
                ["BANK", "Banco"],
              ]}
              onChange={(v) => {
                setFundingMode(v);
                submit();
              }}
            />
            {fundingMode === "BANK" && (
              <select
                name="bankProfileId"
                value={bankProfileId}
                onChange={(e) => {
                  setBankProfileId(e.target.value);
                  submit();
                }}
                className={inputClass}
              >
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div>
          <span className={labelClass}>Remuneração 4U</span>
          <div className="flex items-center gap-2">
            <select
              value={compMode}
              onChange={(e) => {
                setCompMode(e.target.value);
                submit();
              }}
              className={inputClass}
            >
              <option value="PERFORMANCE">Performance (% do lucro)</option>
              <option value="PROMOTE">Promote (waterfall)</option>
              <option value="CONTRACTOR_FEE">Contractor fee</option>
              <option value="OPEN_BOOK">Open book + taxa flat</option>
            </select>
            {compMode === "PERFORMANCE" && (
              <>
                <input
                  value={perfPct}
                  onChange={(e) => setPerfPct(e.target.value)}
                  onBlur={submit}
                  className={`${inputClass} w-16 text-right`}
                />
                <span className="text-xs text-slate-400">%</span>
                <select
                  value={perfTiming}
                  onChange={(e) => {
                    setPerfTiming(e.target.value);
                    submit();
                  }}
                  className={inputClass}
                >
                  <option value="PROJECT_COMPLETION">na conclusão</option>
                  <option value="PER_SALE">por venda</option>
                </select>
              </>
            )}
            {compMode === "OPEN_BOOK" && (
              <>
                <span className="text-xs text-slate-400">flat $</span>
                <input
                  value={flatFee}
                  onChange={(e) => setFlatFee(e.target.value)}
                  onBlur={submit}
                  className={`${inputClass} w-24 text-right`}
                />
                <span className="text-xs text-slate-400">/casa</span>
              </>
            )}
          </div>
        </div>

        <div className="ml-auto pb-2">
          {pending ? (
            <span className="text-xs text-slate-400">Recalculando…</span>
          ) : (
            <span className="text-xs text-slate-300">ajuste e o resultado recalcula</span>
          )}
        </div>
      </div>
      {state?.error && !pending && (
        <p className="mt-2 text-sm text-red-600">
          Não recalculou: {state.error}
        </p>
      )}
    </form>
  );
}
