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
    costOpenBook: number | null;
  }>;
  scenarios: Array<{ code: string; name: string }>;
  banks: Array<{ id: string; name: string }>;
  pools: Array<{ id: string; code: string; name: string }>;
  // default do catálogo — a simulação carrega uma CÓPIA ao ligar o waterfall
  waterfallTiers?: Array<{ hurdlePct: number | null; promotePct: number }>;
};

export type UnitRow = { locationId: string; modelId: string; cycle: number };

// Modal de adição de casa: localização primeiro → modelos daquela localização, com os
// valores de construção/venda; quantidade cria N linhas iguais de uma vez.
// Exportado: também usado pelo editor de cesta da página de resultado.
export function AddHouseModal({
  catalog,
  modelsFor,
  allowCycles,
  defaultCycle,
  onAdd,
  onClose,
}: {
  catalog: SimCatalog;
  modelsFor: Map<string, SimCatalog["modelLocations"]>;
  allowCycles: boolean; // esteira de ciclos é só para equity
  defaultCycle?: number; // ciclo pré-selecionado (ex.: "+ modelo neste ciclo")
  onAdd: (locationId: string, modelId: string, qty: number, cycle: number) => void;
  onClose: () => void;
}) {
  const [locationId, setLocationId] = useState("");
  const [modelId, setModelId] = useState("");
  const [qty, setQty] = useState("1");
  const [cycle, setCycle] = useState(String(defaultCycle ?? 1));
  const models = modelsFor.get(locationId) ?? [];
  const sel = models.find((m) => m.modelId === modelId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6"
      onClick={onClose}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-800">Adicionar casa</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="space-y-4 px-6 py-4">
          {allowCycles && (
            <div className="w-28">
              <label className={labelClass}>Ciclo</label>
              <input value={cycle} onChange={(e) => setCycle(e.target.value)} className={inputClass} />
              <p className="mt-1 text-[11px] leading-snug text-slate-400">
                Ciclo 1 = cesta inicial; 2+ = engatilhada (obra começa na venda do ciclo anterior)
              </p>
            </div>
          )}
          <div>
            <label className={labelClass}>Localização *</label>
            <select
              value={locationId}
              onChange={(e) => {
                setLocationId(e.target.value);
                setModelId("");
              }}
              className={inputClass}
            >
              <option value="">Selecione…</option>
              {catalog.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Modelo *</label>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              disabled={!locationId}
              className={inputClass}
            >
              <option value="">{locationId ? "Selecione…" : "escolha a localização"}</option>
              {models.map((m) => (
                <option key={m.modelId} value={m.modelId}>
                  {m.modelName}
                </option>
              ))}
            </select>
          </div>
          {sel && (
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-center md:grid-cols-4">
              <div>
                <div className="text-xs text-slate-400">Construção (perf)</div>
                <div className="text-sm font-medium tabular-nums">
                  {sel.costPerformance != null ? `$${sel.costPerformance.toLocaleString("en-US")}` : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Construção (contractor)</div>
                <div className="text-sm font-medium tabular-nums">
                  {sel.costContractor != null ? `$${sel.costContractor.toLocaleString("en-US")}+fee` : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Open book</div>
                <div className="text-sm font-medium tabular-nums">
                  {sel.costOpenBook != null ? `$${sel.costOpenBook.toLocaleString("en-US")}+flat` : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Venda</div>
                <div className="text-sm font-medium tabular-nums">
                  ${sel.salePrice.toLocaleString("en-US")}
                </div>
              </div>
            </div>
          )}
          <div className="w-28">
            <label className={labelClass}>Quantidade</label>
            <input value={qty} onChange={(e) => setQty(e.target.value)} className={inputClass} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!locationId || !modelId}
              onClick={() => onAdd(locationId, modelId, Math.max(1, Math.round(Number(qty) || 1)), Math.max(1, Math.round(Number(cycle) || 1)))}
              className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
            >
              Adicionar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SimulationForm({ catalog }: { catalog: SimCatalog }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createSimulation,
    undefined,
  );
  const [fundingMode, setFundingMode] = useState("BANK");
  const [compMode, setCompMode] = useState("PERFORMANCE");
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  // waterfall = promote da VIXUS (Development Manager) — opt-in em qualquer modalidade
  const [waterfallOn, setWaterfallOn] = useState(false);
  const [vehicle, setVehicle] = useState("VIXUS_MANAGED");
  const [tiers, setTiers] = useState<Array<{ hurdlePct: string; promotePct: string }>>(
    catalog.waterfallTiers?.length
      ? catalog.waterfallTiers.map((t) => ({
          hurdlePct: t.hurdlePct == null ? "" : String(t.hurdlePct),
          promotePct: String(t.promotePct),
        }))
      : [
          { hurdlePct: "8", promotePct: "0" },
          { hurdlePct: "15", promotePct: "20" },
          { hurdlePct: "", promotePct: "35" },
        ],
  );
  const tiersActive = waterfallOn;

  const modelsFor = useMemo(() => {
    const map = new Map<string, SimCatalog["modelLocations"]>();
    for (const ml of catalog.modelLocations) {
      const list = map.get(ml.locationId) ?? [];
      list.push(ml);
      map.set(ml.locationId, list);
    }
    return map;
  }, [catalog.modelLocations]);

  const validUnits = units.filter((u) => u.locationId && u.modelId);

  return (
    <form action={formAction} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
      <input type="hidden" name="units" value={JSON.stringify(validUnits)} />
      <input
        type="hidden"
        name="promoteTiers"
        value={
          tiersActive
            ? JSON.stringify(
                tiers.map((t) => ({
                  hurdlePct: t.hurdlePct.trim() === "" ? null : Number(t.hurdlePct),
                  promotePct: Number(t.promotePct),
                })),
              )
            : ""
        }
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
            <option value="CONTRACTOR_FEE">Contractor fee (fixed)</option>
            <option value="OPEN_BOOK">Open book + taxa flat por casa</option>
          </select>
        </div>
        {compMode === "OPEN_BOOK" && (
          <>
            <div>
              <label htmlFor="sim-flat" className={labelClass}>
                Taxa flat 4U por casa $
              </label>
              <input
                id="sim-flat"
                name="flatFeePerHouse"
                defaultValue="20000"
                className={inputClass}
              />
            </div>
          </>
        )}
        <div>
          <label
            className="flex items-center gap-2 pt-6 text-sm text-slate-600"
            title="Waterfall/promote da Vixus como Development Manager — por cima da remuneração da 4U"
          >
            <input
              type="checkbox"
              checked={waterfallOn}
              onChange={(e) => setWaterfallOn(e.target.checked)}
            />{" "}
            Vixus: waterfall (promote)
          </label>
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
          <label htmlFor="sim-vehicle" className={labelClass}>
            Estrutura do veículo
          </label>
          <select
            id="sim-vehicle"
            name="vehicleStructure"
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value)}
            className={inputClass}
          >
            <option value="VIXUS_MANAGED">Veículo Vixus (LLC dedicada)</option>
            <option value="CLIENT_ENTITY">Entidade do cliente (Vixus = Development Manager)</option>
          </select>
        </div>
        {vehicle === "CLIENT_ENTITY" && (
          <div>
            <label htmlFor="sim-entity" className={labelClass}>
              Nome da entidade do cliente
            </label>
            <input
              id="sim-entity"
              name="clientEntityName"
              placeholder="ex.: Falcon Family Holdings LLC"
              className={inputClass}
            />
          </div>
        )}
        <div>
          <label htmlFor="sim-plan" className={labelClass}>
            Plano de desembolso
          </label>
          <select id="sim-plan" name="paymentPlan" defaultValue="STANDARD" className={inputClass}>
            <option value="STANDARD">Padrão — 10/30/20/20/15/5</option>
            <option value="LIGHT_START">Início leve — 10/15/25/25/20/5</option>
            <option value="PARTNER">Sócios — 10/10/25/25/25/5</option>
          </select>
        </div>
      </div>

      {tiersActive && (
        <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-4">
          <h3 className="text-sm font-semibold text-slate-700">
            Tiers do waterfall da Vixus (developer)
          </h3>
          <p className="mb-3 text-xs text-slate-400">
            Hurdle = retorno a.a. do investidor sobre o capital médio em risco. Cada faixa
            entrega o promote % à VIXUS (developer); hurdle vazio = acima do último. Pago na conclusão.
            {compMode === "OPEN_BOOK" &&
              " No open book o waterfall é por cima da taxa flat — remova todos os tiers para simular só a taxa."}
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
                <label className="text-xs text-slate-500">% a.a. → Vixus leva</label>
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
            onClick={() => setModalOpen(true)}
            className="rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#16304f]"
          >
            + Add house
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-100">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">#</th>
                {fundingMode === "EQUITY" && (
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Ciclo</th>
                )}
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Local</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Modelo</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">
                  Construção
                  {compMode === "CONTRACTOR_FEE" ? " (+fee)" : compMode === "OPEN_BOOK" ? " (+flat)" : ""}
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">Venda</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {validUnits.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-5 text-center text-sm text-slate-400">
                    Nenhuma casa — clique em "+ Add house" para escolher local e modelo.
                  </td>
                </tr>
              )}
              {units.map((u, i) => {
                const sel = (modelsFor.get(u.locationId) ?? []).find((m) => m.modelId === u.modelId);
                if (!sel) return null;
                const locName = catalog.locations.find((l) => l.id === u.locationId)?.name ?? "";
                const cost =
                  compMode === "CONTRACTOR_FEE"
                    ? sel.costContractor
                    : compMode === "OPEN_BOOK"
                      ? sel.costOpenBook
                      : sel.costPerformance;
                return (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="px-3 py-2 text-xs text-slate-400">{i + 1}</td>
                    {fundingMode === "EQUITY" && (
                      <td className="px-3 py-2 text-sm text-slate-600">C{u.cycle || 1}</td>
                    )}
                    <td className="px-3 py-2 text-sm text-slate-600">{locName}</td>
                    <td className="px-3 py-2 text-sm font-medium text-slate-800">{sel.modelName}</td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums text-slate-700">
                      {cost != null ? `$${cost.toLocaleString("en-US")}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums text-slate-700">
                      ${sel.salePrice.toLocaleString("en-US")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setUnits((rows) => rows.filter((_, j) => j !== i))}
                        className="text-xs text-slate-300 hover:text-red-500"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
              {validUnits.length > 0 && (
                <tr className="bg-slate-50/60">
                  <td colSpan={fundingMode === "EQUITY" ? 4 : 3} className="px-3 py-2 text-sm font-semibold text-slate-800">
                    Total ({validUnits.length} casas{fundingMode === "EQUITY" ? ` · ${[...new Set(validUnits.map((u) => u.cycle || 1))].length} ciclo(s)` : ""})
                  </td>
                  <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">
                    $
                    {validUnits
                      .reduce((s, u) => {
                        const sel = (modelsFor.get(u.locationId) ?? []).find((m) => m.modelId === u.modelId);
                        const cost =
                          compMode === "CONTRACTOR_FEE"
                            ? sel?.costContractor
                            : compMode === "OPEN_BOOK"
                              ? sel?.costOpenBook
                              : sel?.costPerformance;
                        return s + (cost ?? 0);
                      }, 0)
                      .toLocaleString("en-US")}
                  </td>
                  <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">
                    $
                    {validUnits
                      .reduce((s, u) => {
                        const sel = (modelsFor.get(u.locationId) ?? []).find((m) => m.modelId === u.modelId);
                        return s + (sel?.salePrice ?? 0);
                      }, 0)
                      .toLocaleString("en-US")}
                  </td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Custos, prazos e lotes vêm do catálogo; os buffers do cenário são aplicados por cima.
        </p>
      </div>

      {modalOpen && (
        <AddHouseModal
          catalog={catalog}
          modelsFor={modelsFor}
          allowCycles={fundingMode === "EQUITY"}
          onAdd={(locationId, modelId, qty, cycle) => {
            setUnits((rows) => [
              ...rows.filter((r) => r.locationId && r.modelId),
              ...Array.from({ length: qty }, () => ({
                locationId,
                modelId,
                cycle: fundingMode === "EQUITY" ? cycle : 1,
              })),
            ]);
            setModalOpen(false);
          }}
          onClose={() => setModalOpen(false)}
        />
      )}

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
