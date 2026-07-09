"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { createSimulation, type FormState } from "@/lib/actions/simulations";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export type SimCatalog = {
  locations: Array<{ id: string; name: string }>;
  // combinações disponíveis modelo×local com preço para exibição
  modelLocations: Array<{
    locationId: string;
    modelId: string;
    modelName: string;
    salePrice: number;
    costPerformance: number | null;
    costContractor: number | null;
  }>;
  scenarios: Array<{ code: string; name: string }>;
  banks: Array<{ id: string; name: string }>;
  pools: Array<{ id: string; code: string; name: string }>;
};

type UnitRow = { locationId: string; modelId: string };

export function SimulationForm({ catalog }: { catalog: SimCatalog }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createSimulation,
    undefined,
  );
  const [fundingMode, setFundingMode] = useState("BANK");
  const [compMode, setCompMode] = useState("PERFORMANCE");
  const [units, setUnits] = useState<UnitRow[]>([{ locationId: "", modelId: "" }]);
  const [tiers, setTiers] = useState<Array<{ hurdlePct: string; promotePct: string }>>([
    { hurdlePct: "8", promotePct: "0" },
    { hurdlePct: "15", promotePct: "20" },
    { hurdlePct: "", promotePct: "35" },
  ]);

  const modelsFor = useMemo(() => {
    const map = new Map<string, SimCatalog["modelLocations"]>();
    for (const ml of catalog.modelLocations) {
      const list = map.get(ml.locationId) ?? [];
      list.push(ml);
      map.set(ml.locationId, list);
    }
    return map;
  }, [catalog.modelLocations]);

  const setUnit = (i: number, patch: Partial<UnitRow>) =>
    setUnits((u) => u.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const validUnits = units.filter((u) => u.locationId && u.modelId);

  return (
    <form action={formAction} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
      <input type="hidden" name="units" value={JSON.stringify(validUnits)} />
      <input
        type="hidden"
        name="promoteTiers"
        value={JSON.stringify(
          tiers.map((t) => ({
            hurdlePct: t.hurdlePct.trim() === "" ? null : Number(t.hurdlePct),
            promotePct: Number(t.promotePct),
          })),
        )}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="col-span-2">
          <label htmlFor="sim-name" className={labelClass}>
            Name *
          </label>
          <input id="sim-name" name="name" required placeholder="PH4 — 8 casas Port Charlotte" className={inputClass} />
        </div>
        <div>
          <label htmlFor="sim-scenario" className={labelClass}>
            Scenario
          </label>
          <select id="sim-scenario" name="scenarioCode" defaultValue="CONS" className={inputClass}>
            {catalog.scenarios.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sim-pool" className={labelClass}>
            Link to pool (optional)
          </label>
          <select id="sim-pool" name="poolId" defaultValue="" className={inputClass}>
            <option value="">—</option>
            {catalog.pools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <label htmlFor="sim-funding" className={labelClass}>
            Funding
          </label>
          <select
            id="sim-funding"
            name="fundingMode"
            value={fundingMode}
            onChange={(e) => setFundingMode(e.target.value)}
            className={inputClass}
          >
            <option value="EQUITY">Equity (100% investors)</option>
            <option value="BANK">Bank construction loan</option>
          </select>
        </div>
        {fundingMode === "BANK" && (
          <>
            <div>
              <label htmlFor="sim-bank" className={labelClass}>
                Bank profile
              </label>
              <select id="sim-bank" name="bankProfileId" defaultValue={catalog.banks[0]?.id ?? ""} className={inputClass}>
                {catalog.banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sim-gate" className={labelClass}>
                Equity gate %
              </label>
              <input id="sim-gate" name="equityGatePct" defaultValue="10" className={inputClass} />
            </div>
          </>
        )}
        <div>
          <label htmlFor="sim-comp" className={labelClass}>
            4U compensation
          </label>
          <select
            id="sim-comp"
            name="compMode"
            value={compMode}
            onChange={(e) => setCompMode(e.target.value)}
            className={inputClass}
          >
            <option value="PERFORMANCE">Performance (% of profit)</option>
            <option value="PROMOTE">Promote (waterfall)</option>
            <option value="CONTRACTOR_FEE">Contractor fee (fixed)</option>
          </select>
        </div>
        {compMode === "PERFORMANCE" && (
          <>
            <div>
              <label htmlFor="sim-perf" className={labelClass}>
                Performance % (before split)
              </label>
              <input id="sim-perf" name="perfPct" defaultValue="35" className={inputClass} />
            </div>
            <div>
              <label htmlFor="sim-perf-timing" className={labelClass}>
                Performance paga
              </label>
              <select
                id="sim-perf-timing"
                name="perfTiming"
                defaultValue="PROJECT_COMPLETION"
                className={inputClass}
              >
                <option value="PROJECT_COMPLETION">Na conclusão do projeto</option>
                <option value="PER_SALE">Na venda de cada casa</option>
              </select>
            </div>
          </>
        )}
        <div>
          <label htmlFor="sim-plan" className={labelClass}>
            Plano de desembolso
          </label>
          <select id="sim-plan" name="paymentPlan" defaultValue="STANDARD" className={inputClass}>
            <option value="STANDARD">Padrão — 10/30/20/20/15/5</option>
            <option value="LIGHT_START">Início leve — 10/15/25/25/20/5</option>
          </select>
        </div>
        <div>
          <label className="flex items-center gap-2 pt-6 text-sm text-slate-600">
            <input type="checkbox" name="parallelPermit" /> Permit parallel to lot purchase
          </label>
        </div>
      </div>

      {compMode === "PROMOTE" && (
        <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-4">
          <h3 className="text-sm font-semibold text-slate-700">Tiers do promote</h3>
          <p className="mb-3 text-xs text-slate-400">
            Hurdle = retorno a.a. do investidor sobre o capital médio em risco. Cada faixa
            entrega o promote % à 4U; hurdle vazio = acima do último. Pago na conclusão.
          </p>
          <div className="space-y-2">
            {tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-12 text-xs text-slate-400">Tier {i + 1}</span>
                <label className="text-xs text-slate-500">até</label>
                <input
                  value={t.hurdlePct}
                  onChange={(e) =>
                    setTiers((ts) => ts.map((x, j) => (j === i ? { ...x, hurdlePct: e.target.value } : x)))
                  }
                  placeholder="acima"
                  className={`${inputClass} w-20`}
                />
                <label className="text-xs text-slate-500">% a.a. → 4U leva</label>
                <input
                  value={t.promotePct}
                  onChange={(e) =>
                    setTiers((ts) => ts.map((x, j) => (j === i ? { ...x, promotePct: e.target.value } : x)))
                  }
                  className={`${inputClass} w-20`}
                />
                <label className="text-xs text-slate-500">%</label>
                <button
                  type="button"
                  onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))}
                  className="text-xs text-slate-300 hover:text-red-500"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setTiers((ts) => [...ts, { hurdlePct: "", promotePct: "" }])}
            className="mt-2 rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
          >
            + Tier
          </button>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Houses</h3>
          <button
            type="button"
            onClick={() => setUnits((u) => [...u, { locationId: "", modelId: "" }])}
            className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            + Add house
          </button>
        </div>
        <div className="space-y-2">
          {units.map((u, i) => {
            const models = modelsFor.get(u.locationId) ?? [];
            const sel = models.find((m) => m.modelId === u.modelId);
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-xs text-slate-400">{i + 1}</span>
                <select
                  value={u.locationId}
                  onChange={(e) => setUnit(i, { locationId: e.target.value, modelId: "" })}
                  className={`${inputClass} w-48`}
                >
                  <option value="">Location…</option>
                  {catalog.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <select
                  value={u.modelId}
                  onChange={(e) => setUnit(i, { modelId: e.target.value })}
                  className={`${inputClass} w-48`}
                  disabled={!u.locationId}
                >
                  <option value="">Model…</option>
                  {models.map((m) => (
                    <option key={m.modelId} value={m.modelId}>
                      {m.modelName}
                    </option>
                  ))}
                </select>
                {sel && (
                  <span className="text-xs text-slate-400">
                    {compMode === "PERFORMANCE"
                      ? `cost ${sel.costPerformance != null ? `$${sel.costPerformance.toLocaleString()}` : "—"}`
                      : `cost ${sel.costContractor != null ? `$${sel.costContractor.toLocaleString()}+fee` : "—"}`}{" "}
                    · sale ${sel.salePrice.toLocaleString()}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setUnits((rows) => rows.filter((_, j) => j !== i))}
                  className="text-xs text-slate-300 hover:text-red-500"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {validUnits.length} house(s) ready. Costs, timing and lot values come from the catalog;
          the scenario buffers are applied on top.
        </p>
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div className="flex items-center justify-end gap-3">
        <Link
          href="/pools/simulator"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending || validUnits.length === 0}
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
        >
          {pending ? "Simulating…" : "▶ Run simulation"}
        </button>
      </div>
    </form>
  );
}
