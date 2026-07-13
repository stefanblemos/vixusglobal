"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { updateSimulationOverrides, type FormState } from "@/lib/actions/simulations";

// Aba Premissas: ajuste fino POR SIMULAÇÃO (regra do Stefan, 13/07): os campos vêm
// PRÉ-PREENCHIDOS como cópia do catálogo; editar muda só esta simulação — o default
// (catálogo) não muda, e campo não tocado continua seguindo o catálogo. Os buffers do
// cenário escolhido aplicam POR CIMA destes valores.

const inputClass =
  "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right tabular-nums outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";
const thR = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400";

export type PremissasLocation = {
  id: string;
  name: string;
  catalog: { lotCost: number | null; lotLeadDays: number; permitDays: number; saleDays: number };
};
export type PremissasCombo = {
  key: string; // modelId|locationId
  label: string; // "Modelo @ Location"
  catalog: {
    salePrice: number;
    costPerformance: number | null;
    costContractor: number | null;
    costOpenBook: number | null;
    contractorFee: number;
    buildMonths: number;
  };
};
type Overrides = {
  locations?: Record<string, Record<string, number>>;
  combos?: Record<string, Record<string, number>>;
};

const LOC_FIELDS = [
  ["lotCost", "Lote $"],
  ["lotLeadDays", "Busca (d)"],
  ["permitDays", "Permit (d)"],
  ["saleDays", "Venda (d)"],
] as const;
const COMBO_FIELDS = [
  ["salePrice", "Venda $"],
  ["costPerformance", "Perf $"],
  ["costContractor", "Contractor $"],
  ["costOpenBook", "Open book $"],
  ["contractorFee", "Fee $"],
  ["buildMonths", "Obra (m)"],
] as const;

function Cell({
  value,
  catalog,
  onChange,
}: {
  value: string;
  catalog: number | null;
  onChange: (v: string) => void;
}) {
  const differs = catalog != null && value !== "" && Number(value) !== catalog;
  return (
    <div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} ${differs ? "border-amber-400 bg-amber-50/60" : ""}`}
      />
      {differs && (
        <button
          type="button"
          onClick={() => onChange(catalog == null ? "" : String(catalog))}
          title="Voltar ao catálogo"
          className="mt-0.5 block w-full text-right text-[10px] text-amber-600 hover:underline"
        >
          catálogo: {catalog?.toLocaleString("en-US")} ↺
        </button>
      )}
    </div>
  );
}

export function SimulationPremissas({
  simulationId,
  scenarioName,
  locations,
  combos,
  overrides,
}: {
  simulationId: string;
  scenarioName: string;
  locations: PremissasLocation[];
  combos: PremissasCombo[];
  overrides: Overrides | null;
}) {
  // estado inicial: override ?? catálogo (cópia editável)
  const initial = useMemo(() => {
    const loc: Record<string, Record<string, string>> = {};
    for (const l of locations) {
      loc[l.id] = {};
      for (const [k] of LOC_FIELDS) {
        const ov = overrides?.locations?.[l.id]?.[k];
        const cat = l.catalog[k as keyof typeof l.catalog];
        loc[l.id][k] = ov != null ? String(ov) : cat != null ? String(cat) : "";
      }
    }
    const cmb: Record<string, Record<string, string>> = {};
    for (const c of combos) {
      cmb[c.key] = {};
      for (const [k] of COMBO_FIELDS) {
        const ov = overrides?.combos?.[c.key]?.[k];
        const cat = c.catalog[k as keyof typeof c.catalog];
        cmb[c.key][k] = ov != null ? String(ov) : cat != null ? String(cat) : "";
      }
    }
    return { loc, cmb };
  }, [locations, combos, overrides]);

  const [loc, setLoc] = useState(initial.loc);
  const [cmb, setCmb] = useState(initial.cmb);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateSimulationOverrides,
    undefined,
  );

  const payload: Overrides = useMemo(() => {
    const out: Overrides = { locations: {}, combos: {} };
    for (const [id, fields] of Object.entries(loc)) {
      const e: Record<string, number> = {};
      for (const [k, v] of Object.entries(fields)) if (v !== "" && Number.isFinite(Number(v))) e[k] = Number(v);
      if (Object.keys(e).length) out.locations![id] = e;
    }
    for (const [key, fields] of Object.entries(cmb)) {
      const e: Record<string, number> = {};
      for (const [k, v] of Object.entries(fields)) if (v !== "" && Number.isFinite(Number(v))) e[k] = Number(v);
      if (Object.keys(e).length) out.combos![key] = e;
    }
    return out;
  }, [loc, cmb]);

  const touched =
    locations.some((l) =>
      LOC_FIELDS.some(([k]) => {
        const cat = l.catalog[k as keyof typeof l.catalog];
        const v = loc[l.id]?.[k] ?? "";
        return v !== "" && cat != null && Number(v) !== cat;
      }),
    ) ||
    combos.some((c) =>
      COMBO_FIELDS.some(([k]) => {
        const cat = c.catalog[k as keyof typeof c.catalog];
        const v = cmb[c.key]?.[k] ?? "";
        return v !== "" && cat != null && Number(v) !== cat;
      }),
    );

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-medium text-slate-800">Premissas desta simulação</h2>
          <p className="text-xs text-slate-400">
            Cópia editável do catálogo — mudar aqui NÃO altera o catálogo nem afeta outras
            simulações; campo não tocado continua seguindo o catálogo. Os buffers do cenário
            ({scenarioName}) aplicam por cima destes valores; no banco, o sizing usa o valor
            ajustado. Valores em âmbar divergem do catálogo.
          </p>
        </div>

        <div className="space-y-5 px-5 py-4">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Locations da cesta</h3>
            <div className="overflow-x-auto rounded-lg border border-slate-100">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className={th}>Location</th>
                    {LOC_FIELDS.map(([k, label]) => (
                      <th key={k} className={thR}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {locations.map((l) => (
                    <tr key={l.id} className="border-b border-slate-50">
                      <td className="px-3 py-2 text-sm font-medium text-slate-800">{l.name}</td>
                      {LOC_FIELDS.map(([k]) => (
                        <td key={k} className="w-32 px-2 py-1.5">
                          <Cell
                            value={loc[l.id]?.[k] ?? ""}
                            catalog={l.catalog[k as keyof typeof l.catalog]}
                            onChange={(v) => setLoc((s) => ({ ...s, [l.id]: { ...s[l.id], [k]: v } }))}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Casas da cesta (modelo × location)</h3>
            <div className="overflow-x-auto rounded-lg border border-slate-100">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className={th}>Combinação</th>
                    {COMBO_FIELDS.map(([k, label]) => (
                      <th key={k} className={thR}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {combos.map((c) => (
                    <tr key={c.key} className="border-b border-slate-50">
                      <td className="px-3 py-2 text-sm font-medium text-slate-800">{c.label}</td>
                      {COMBO_FIELDS.map(([k]) => (
                        <td key={k} className="w-32 px-2 py-1.5">
                          <Cell
                            value={cmb[c.key]?.[k] ?? ""}
                            catalog={c.catalog[k as keyof typeof c.catalog]}
                            onChange={(v) => setCmb((s) => ({ ...s, [c.key]: { ...s[c.key], [k]: v } }))}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

          <form action={formAction} className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                // restaura TUDO para o catálogo (limpa overrides no próximo salvar)
                const locReset: typeof loc = {};
                for (const l of locations) {
                  locReset[l.id] = {};
                  for (const [k] of LOC_FIELDS) {
                    const cat = l.catalog[k as keyof typeof l.catalog];
                    locReset[l.id][k] = cat != null ? String(cat) : "";
                  }
                }
                const cmbReset: typeof cmb = {};
                for (const c of combos) {
                  cmbReset[c.key] = {};
                  for (const [k] of COMBO_FIELDS) {
                    const cat = c.catalog[k as keyof typeof c.catalog];
                    cmbReset[c.key][k] = cat != null ? String(cat) : "";
                  }
                }
                setLoc(locReset);
                setCmb(cmbReset);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-100"
            >
              ↺ Restaurar tudo ao catálogo
            </button>
            <div className="flex items-center gap-3">
              {touched && <span className="text-xs text-amber-600">há valores divergindo do catálogo</span>}
              <input type="hidden" name="simulationId" value={simulationId} />
              <input type="hidden" name="overrides" value={JSON.stringify(payload)} />
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
              >
                {pending ? "Re-rodando…" : "Salvar e re-rodar"}
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
