"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { updateSimulationSettings, type FormState } from "@/lib/actions/simulations";

const labelClass = "mb-1 block text-xs text-slate-400";
const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f]";

type Tier = { hurdlePct: string; promotePct: string };

const DEFAULT_TIERS: Tier[] = [
  { hurdlePct: "8", promotePct: "0" },
  { hurdlePct: "15", promotePct: "20" },
  { hurdlePct: "", promotePct: "35" },
];

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

// Alavancas da simulação "viva": cenário, funding, remuneração e plano de desembolso
// recalculam na hora (sobrescreve o snapshot — para guardar uma versão, duplique).
// IMPORTANTE: montar com key derivada dos valores salvos (a página faz isso) — o React 19
// reseta o form após cada action e dessincroniza selects controlados; a remontagem pós-
// sucesso realinha a tela com o banco. Erros da action aparecem abaixo dos controles.
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
    paymentPlan: string;
    upfrontFunding: boolean;
    vehicleStructure: string;
    clientEntityName: string | null;
    promoteTiers: Array<{ hurdlePct: number | null; promotePct: number }> | null;
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
  const [paymentPlan, setPaymentPlan] = useState(sim.paymentPlan);
  const [vehicle, setVehicle] = useState(sim.vehicleStructure ?? "VIXUS_MANAGED");
  const [entityName, setEntityName] = useState(sim.clientEntityName ?? "");
  const [upfront, setUpfront] = useState(sim.upfrontFunding);
  // waterfall = promote da VIXUS (Development Manager) — opt-in em QUALQUER modalidade
  // da 4U (regra do Stefan, 14/07); PROMOTE legado continua forçando os tiers
  const savedTiers: Tier[] = (sim.promoteTiers ?? []).map((t) => ({
    hurdlePct: t.hurdlePct == null ? "" : String(t.hurdlePct),
    promotePct: String(t.promotePct),
  }));
  const [waterfallOn, setWaterfallOn] = useState(savedTiers.length > 0);
  const [tiers, setTiers] = useState<Tier[]>(savedTiers.length > 0 ? savedTiers : DEFAULT_TIERS);

  const tiersActive = compMode === "PROMOTE" || waterfallOn;
  const tiersJson = tiersActive
    ? JSON.stringify(
        tiers.map((t) => ({
          hurdlePct: t.hurdlePct.trim() === "" ? null : Number(t.hurdlePct),
          promotePct: Number(t.promotePct),
        })),
      )
    : "";

  // Se a action falhou, os valores salvos NÃO mudaram — realinha os selects com o banco
  useEffect(() => {
    if (state?.error) {
      setScenarioCode(sim.scenarioCode);
      setFundingMode(sim.fundingMode);
      setBankProfileId(sim.bankProfileId ?? banks[0]?.id ?? "");
      setCompMode(sim.compMode);
      setPerfPct(sim.perfPct);
      setPerfTiming(sim.perfTiming);
      setFlatFee(sim.flatFeePerHouse);
      setPaymentPlan(sim.paymentPlan);
      setUpfront(sim.upfrontFunding);
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
        <input type="hidden" name="paymentPlan" value={paymentPlan} />
        <input type="hidden" name="promoteTiers" value={tiersJson} />
        <input type="hidden" name="vehicleStructure" value={vehicle} />
        <input type="hidden" name="clientEntityName" value={entityName} />

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
          <span className={labelClass}>Aporte</span>
          <label
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600"
            title="Todo o capital entra no dia zero (mínimo p/ nunca faltar caixa) em vez do just-in-time — mostra o impacto do capital parado na TIR"
          >
            <input
              type="checkbox"
              name="upfrontFunding"
              checked={upfront}
              onChange={(e) => {
                setUpfront(e.target.checked);
                submit();
              }}
            />
            100% em D+0
          </label>
        </div>

        <div>
          <span className={labelClass}>Desembolso da obra</span>
          <select
            value={paymentPlan}
            onChange={(e) => {
              setPaymentPlan(e.target.value);
              submit();
            }}
            className={inputClass}
          >
            <option value="STANDARD">Padrão — 10/30/20/20/15/5</option>
            <option value="LIGHT_START">Início leve — 10/15/25/25/20/5</option>
            <option value="PARTNER">Sócios — 10/10/25/25/25/5</option>
          </select>
        </div>

        <div>
          <span className={labelClass}>Remuneração 4U</span>
          <div className="flex items-center gap-2">
            <select
              value={compMode}
              onChange={(e) => {
                const v = e.target.value;
                setCompMode(v);
                submit();
              }}
              className={inputClass}
            >
              <option value="PERFORMANCE">Performance (% do lucro)</option>
              <option value="CONTRACTOR_FEE">Contractor fee</option>
              <option value="OPEN_BOOK">Open book + taxa flat</option>
              {compMode === "PROMOTE" && <option value="PROMOTE">Promote (legado)</option>}
            </select>
            {compMode === "PERFORMANCE" && (
              <>
                <input
                  value={perfPct}
                  onChange={(e) => setPerfPct(e.target.value)}
                  onBlur={submit}
                  title="Performance % (antes do split)"
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

        <div>
          <span className={labelClass}>Estrutura</span>
          <div className="flex items-center gap-2">
            <select
              value={vehicle}
              onChange={(e) => {
                setVehicle(e.target.value);
                submit();
              }}
              className={inputClass}
            >
              <option value="VIXUS_MANAGED">Veículo Vixus</option>
              <option value="CLIENT_ENTITY">Entidade do cliente</option>
            </select>
            {vehicle === "CLIENT_ENTITY" && (
              <input
                value={entityName}
                onChange={(e) => setEntityName(e.target.value)}
                onBlur={submit}
                placeholder="nome da entidade"
                className={`${inputClass} w-44`}
              />
            )}
          </div>
        </div>

        <div>
          <span className={labelClass}>Vixus (developer)</span>
          <label
            className="flex items-center gap-1.5 pt-2 text-sm text-slate-600"
            title="Waterfall/promote da Vixus como Development Manager — por cima da remuneração da 4U, pago na conclusão acima dos hurdles"
          >
            <input
              type="checkbox"
              checked={waterfallOn}
              onChange={(e) => {
                setWaterfallOn(e.target.checked);
                submit();
              }}
            />
            waterfall (promote)
          </label>
        </div>

        <div className="ml-auto pb-2">
          {pending ? (
            <span className="text-xs text-slate-400">Recalculando…</span>
          ) : (
            <span className="text-xs text-slate-300">ajuste e o resultado recalcula</span>
          )}
        </div>
      </div>

      {tiersActive && (
        <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">
              Tiers do waterfall — hurdle % a.a. sobre o capital médio em risco → % da faixa p/ a VIXUS (developer)
            </span>
            <button
              type="button"
              onClick={submit}
              className="rounded bg-[#1f3a5f] px-3 py-1 text-xs font-medium text-white hover:bg-[#16304f]"
            >
              Aplicar tiers
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-1.5 text-sm">
                <span className="text-xs text-slate-400">até</span>
                <input
                  value={t.hurdlePct}
                  onChange={(e) =>
                    setTiers((ts) => ts.map((x, j) => (j === i ? { ...x, hurdlePct: e.target.value } : x)))
                  }
                  placeholder="acima"
                  className={`${inputClass} w-16 px-2 py-1 text-right`}
                />
                <span className="text-xs text-slate-400">% → 4U</span>
                <input
                  value={t.promotePct}
                  onChange={(e) =>
                    setTiers((ts) => ts.map((x, j) => (j === i ? { ...x, promotePct: e.target.value } : x)))
                  }
                  className={`${inputClass} w-14 px-2 py-1 text-right`}
                />
                <span className="text-xs text-slate-400">%</span>
                <button
                  type="button"
                  onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))}
                  className="text-xs text-slate-300 hover:text-red-500"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setTiers((ts) => [...ts, { hurdlePct: "", promotePct: "" }])}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
            >
              + Tier
            </button>
          </div>
        </div>
      )}

      {state?.error && !pending && (
        <p className="mt-2 text-sm text-red-600">Não recalculou: {state.error}</p>
      )}
    </form>
  );
}
