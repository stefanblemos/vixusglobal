"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { updateSimulationSettings } from "@/lib/actions/simulations";

const labelClass = "mb-1 block text-xs text-slate-400";
const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f]";

function Pending() {
  const { pending } = useFormStatus();
  return pending ? (
    <span className="text-xs text-slate-400">Recalculando…</span>
  ) : (
    <span className="text-xs text-slate-300">ajuste e o resultado recalcula</span>
  );
}

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
  const [scenarioCode, setScenarioCode] = useState(sim.scenarioCode);
  const [fundingMode, setFundingMode] = useState(sim.fundingMode);
  const [bankProfileId, setBankProfileId] = useState(sim.bankProfileId ?? banks[0]?.id ?? "");
  const [compMode, setCompMode] = useState(sim.compMode);

  const submit = () => requestAnimationFrame(() => formRef.current?.requestSubmit());

  return (
    <form
      ref={formRef}
      action={updateSimulationSettings}
      className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-xl border border-slate-200 bg-white px-5 py-4"
    >
      <input type="hidden" name="simulationId" value={sim.id} />
      <input type="hidden" name="scenarioCode" value={scenarioCode} />
      <input type="hidden" name="fundingMode" value={fundingMode} />
      <input type="hidden" name="compMode" value={compMode} />

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
                name="perfPct"
                defaultValue={sim.perfPct}
                onBlur={submit}
                className={`${inputClass} w-16 text-right`}
              />
              <span className="text-xs text-slate-400">%</span>
              <select name="perfTiming" defaultValue={sim.perfTiming} onChange={submit} className={inputClass}>
                <option value="PROJECT_COMPLETION">na conclusão</option>
                <option value="PER_SALE">por venda</option>
              </select>
            </>
          )}
          {compMode === "OPEN_BOOK" && (
            <>
              <span className="text-xs text-slate-400">flat $</span>
              <input
                name="flatFeePerHouse"
                defaultValue={sim.flatFeePerHouse}
                onBlur={submit}
                className={`${inputClass} w-24 text-right`}
              />
              <span className="text-xs text-slate-400">/casa</span>
            </>
          )}
        </div>
      </div>

      <div className="ml-auto pb-2">
        <Pending />
      </div>
    </form>
  );
}
