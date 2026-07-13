"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { updateSimulationUnits, type FormState } from "@/lib/actions/simulations";
import { AddHouseModal, type SimCatalog, type UnitRow } from "@/components/simulation-form";

// Editor da CESTA de uma simulação existente (casas + ciclos) — mesma UX da criação:
// "+ Add house" abre o modal com Ciclo (só equity), Salvar re-roda o motor na hora.
// A simulação é viva: sobrescreve cesta + snapshot (⧉ Duplicar antes guarda a versão).

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";

export function SimulationUnitsEditor({
  simulationId,
  fundingMode,
  initialUnits,
  catalog,
}: {
  simulationId: string;
  fundingMode: string;
  initialUnits: UnitRow[];
  catalog: Pick<SimCatalog, "locations" | "modelLocations">;
}) {
  const [open, setOpen] = useState(false);
  const [units, setUnits] = useState<UnitRow[]>(initialUnits);
  const [addOpen, setAddOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateSimulationUnits,
    undefined,
  );
  // salvou sem erro → fecha; o revalidate atualiza a página com o snapshot novo
  useEffect(() => {
    if (submitted && !pending && state === undefined) setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, pending, submitted]);

  const isEquity = fundingMode === "EQUITY";
  const modelsFor = useMemo(() => {
    const map = new Map<string, SimCatalog["modelLocations"]>();
    for (const ml of catalog.modelLocations) {
      const list = map.get(ml.locationId) ?? [];
      list.push(ml);
      map.set(ml.locationId, list);
    }
    return map;
  }, [catalog.modelLocations]);

  const cycles = [...new Set(units.map((u) => u.cycle || 1))].sort((a, b) => a - b);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setUnits(initialUnits);
          setSubmitted(false);
          setOpen(true);
        }}
        title="Adicionar/remover casas e ciclos — re-roda o motor na hora (a simulação é viva; duplique antes se quiser guardar a versão atual)"
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
      >
        ✎ Editar cesta
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">Editar cesta</h3>
                <p className="text-xs text-slate-400">
                  {isEquity
                    ? "Ciclo 1 = cesta inicial; 2+ = engatilhada (obra começa na venda do ciclo anterior)."
                    : "Com banco a esteira não se aplica — todas as casas em ciclo único."}
                  {" "}Salvar re-roda o motor e sobrescreve o snapshot.
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">
                  {units.length} casa{units.length === 1 ? "" : "s"}
                  {isEquity && cycles.length > 0 ? ` · ${cycles.length} ciclo(s)` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#16304f]"
                >
                  + Add house
                </button>
              </div>

              <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-100">
                <table className="w-full">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-100">
                      <th className={th}>#</th>
                      {isEquity && <th className={th}>Ciclo</th>}
                      <th className={th}>Local</th>
                      <th className={th}>Modelo</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {units.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-5 text-center text-sm text-slate-400">
                          Cesta vazia — adicione pelo menos uma casa.
                        </td>
                      </tr>
                    )}
                    {units.map((u, i) => {
                      const sel = (modelsFor.get(u.locationId) ?? []).find(
                        (m) => m.modelId === u.modelId,
                      );
                      const locName =
                        catalog.locations.find((l) => l.id === u.locationId)?.name ?? "?";
                      return (
                        <tr key={i} className="border-b border-slate-50">
                          <td className="px-3 py-2 text-xs text-slate-400">{i + 1}</td>
                          {isEquity && (
                            <td className="px-3 py-2 text-sm text-slate-600">
                              <select
                                value={u.cycle || 1}
                                onChange={(e) =>
                                  setUnits((rows) =>
                                    rows.map((r, j) =>
                                      j === i ? { ...r, cycle: Number(e.target.value) } : r,
                                    ),
                                  )
                                }
                                className="rounded border border-slate-200 px-2 py-1 text-sm"
                              >
                                {Array.from(
                                  { length: Math.max(...cycles, u.cycle || 1) + 1 },
                                  (_, k) => k + 1,
                                ).map((c) => (
                                  <option key={c} value={c}>
                                    C{c}
                                  </option>
                                ))}
                              </select>
                            </td>
                          )}
                          <td className="px-3 py-2 text-sm text-slate-600">{locName}</td>
                          <td className="px-3 py-2 text-sm font-medium text-slate-800">
                            {sel?.modelName ?? "?"}
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
                  </tbody>
                </table>
              </div>

              {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

              <form
                action={formAction}
                onSubmit={() => setSubmitted(true)}
                className="flex justify-end gap-2 pt-1"
              >
                <input type="hidden" name="simulationId" value={simulationId} />
                <input type="hidden" name="units" value={JSON.stringify(units)} />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={pending || units.length === 0}
                  className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
                >
                  {pending ? "Re-rodando…" : "Salvar e re-rodar"}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {addOpen && (
        <AddHouseModal
          catalog={{ ...catalog, scenarios: [], banks: [], pools: [] }}
          modelsFor={modelsFor}
          allowCycles={isEquity}
          onAdd={(locationId, modelId, qty, cycle) => {
            setUnits((rows) => [
              ...rows,
              ...Array.from({ length: qty }, () => ({
                locationId,
                modelId,
                cycle: isEquity ? cycle : 1,
              })),
            ]);
            setAddOpen(false);
          }}
          onClose={() => setAddOpen(false)}
        />
      )}
    </>
  );
}
