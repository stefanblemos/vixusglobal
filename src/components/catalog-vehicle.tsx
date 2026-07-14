"use client";

import { useState } from "react";
import { useActionState } from "react";
import {
  saveVehicleCosts,
  saveWaterfallTiers,
  type CatalogFormState,
} from "@/lib/actions/catalog";

// Defaults do VEÍCULO: waterfall da Vixus (developer) e custos estimados da LLC.
// A simulação carrega CÓPIAS destes valores — editar aqui muda só os defaults.

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";

const TIMING_LABEL: Record<string, string> = {
  FORMATION: "Única — abertura (D+0)",
  DISSOLUTION: "Única — encerramento (fim)",
  ANNUAL: "Anual (ano parcial cobra inteiro)",
  MONTHLY: "Mensal (a cada 30d)",
};

export type WaterfallTierRow = { hurdlePct: string; promotePct: string };
export type VehicleCostRow = { name: string; amount: string; timing: string };

export function CatalogVehicle({
  tiers: initialTiers,
  costs: initialCosts,
}: {
  tiers: WaterfallTierRow[];
  costs: VehicleCostRow[];
}) {
  const [tiers, setTiers] = useState<WaterfallTierRow[]>(
    initialTiers.length ? initialTiers : [{ hurdlePct: "8", promotePct: "0" }],
  );
  const [costs, setCosts] = useState<VehicleCostRow[]>(initialCosts);
  const [tierState, tierAction, tierPending] = useActionState<CatalogFormState, FormData>(
    saveWaterfallTiers,
    undefined,
  );
  const [costState, costAction, costPending] = useActionState<CatalogFormState, FormData>(
    saveVehicleCosts,
    undefined,
  );

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-medium text-slate-800">Waterfall da Vixus (default)</h2>
          <p className="text-xs text-slate-400">
            Tiers padrão do promote da Vixus como Development Manager — hurdle % a.a. sobre o
            capital médio em risco → % da faixa para a Vixus. Toda simulação nova carrega uma
            CÓPIA destes tiers ao ligar o waterfall; editar lá não muda este default.
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          {tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-slate-400">até</span>
              <input
                value={t.hurdlePct}
                placeholder="acima"
                onChange={(e) =>
                  setTiers((ts) => ts.map((x, j) => (j === i ? { ...x, hurdlePct: e.target.value } : x)))
                }
                className={`${inputClass} w-20 text-right`}
              />
              <span className="text-xs text-slate-400">% a.a. → Vixus</span>
              <input
                value={t.promotePct}
                onChange={(e) =>
                  setTiers((ts) => ts.map((x, j) => (j === i ? { ...x, promotePct: e.target.value } : x)))
                }
                className={`${inputClass} w-20 text-right`}
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
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => setTiers((ts) => [...ts, { hurdlePct: "", promotePct: "" }])}
              className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
            >
              + Tier
            </button>
            <form action={tierAction} className="flex items-center gap-3">
              {tierState?.error && <span className="text-xs text-red-600">{tierState.error}</span>}
              {tierState?.ok && <span className="text-xs text-emerald-600">salvo ✓</span>}
              <input
                type="hidden"
                name="tiers"
                value={JSON.stringify(
                  tiers.map((t) => ({
                    hurdlePct: t.hurdlePct.trim() === "" ? null : Number(t.hurdlePct),
                    promotePct: Number(t.promotePct),
                  })),
                )}
              />
              <button
                type="submit"
                disabled={tierPending}
                className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
              >
                {tierPending ? "Salvando…" : "Salvar tiers"}
              </button>
            </form>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-medium text-slate-800">Custos do veículo (default)</h2>
          <p className="text-xs text-slate-400">
            Custos estimados da LLC do programa (só quando o veículo é da Vixus): entram como
            fluxos datados na simulação, pagos pelo investidor ANTES do waterfall. A aba
            Premissas da simulação pode ajustar os valores caso a caso.
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          {costs.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={c.name}
                onChange={(e) =>
                  setCosts((cs) => cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
                className={`${inputClass} w-64`}
              />
              <span className="text-xs text-slate-400">$</span>
              <input
                value={c.amount}
                onChange={(e) =>
                  setCosts((cs) => cs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                }
                className={`${inputClass} w-24 text-right`}
              />
              <select
                value={c.timing}
                onChange={(e) =>
                  setCosts((cs) => cs.map((x, j) => (j === i ? { ...x, timing: e.target.value } : x)))
                }
                className={inputClass}
                style={{ width: 260 }}
              >
                {Object.entries(TIMING_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setCosts((cs) => cs.filter((_, j) => j !== i))}
                className="text-xs text-slate-300 hover:text-red-500"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => setCosts((cs) => [...cs, { name: "", amount: "", timing: "ANNUAL" }])}
              className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
            >
              + Custo
            </button>
            <form action={costAction} className="flex items-center gap-3">
              {costState?.error && <span className="text-xs text-red-600">{costState.error}</span>}
              {costState?.ok && <span className="text-xs text-emerald-600">salvo ✓</span>}
              <input
                type="hidden"
                name="costs"
                value={JSON.stringify(
                  costs.map((c) => ({ name: c.name, amount: Number(c.amount), timing: c.timing })),
                )}
              />
              <button
                type="submit"
                disabled={costPending}
                className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
              >
                {costPending ? "Salvando…" : "Salvar custos"}
              </button>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
