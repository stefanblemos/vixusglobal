"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { updateSimulationUnits, type FormState } from "@/lib/actions/simulations";
import { AddHouseModal, type SimCatalog, type UnitRow } from "@/components/simulation-form";

// Editor da CESTA de uma simulação existente (casas + ciclos). Layout acordeão (aprovado
// 23/07): o CICLO é o cabeçalho expansível e as casas ficam AGRUPADAS por modelo dentro,
// com stepper de quantidade. "+ modelo neste ciclo" adiciona direto no ciclo certo. A
// simulação é viva: Salvar re-roda o motor e sobrescreve o snapshot (⧉ Duplicar guarda a versão).

const comboKey = (locationId: string, modelId: string) => `${locationId}|${modelId}`;

type Group = { locationId: string; modelId: string; loc: string; model: string; qty: number };

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
  const [addCycle, setAddCycle] = useState<number | null>(null); // ciclo do "+ modelo"; null = "+ Add house" global
  const [addOpen, setAddOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({ 1: true });
  const [submitted, setSubmitted] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateSimulationUnits,
    undefined,
  );
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

  const nameOf = (u: UnitRow) => ({
    loc: catalog.locations.find((l) => l.id === u.locationId)?.name ?? "?",
    model: (modelsFor.get(u.locationId) ?? []).find((m) => m.modelId === u.modelId)?.modelName ?? "?",
  });
  const cyc = (u: UnitRow) => (isEquity ? u.cycle || 1 : 1);

  // agrupa por ciclo → modelo (local+modelo), com quantidade; ordenado local→modelo
  const grouped = useMemo(() => {
    const byCycle = new Map<number, Map<string, Group>>();
    for (const u of units) {
      const c = cyc(u);
      if (!byCycle.has(c)) byCycle.set(c, new Map());
      const g = byCycle.get(c)!;
      const k = comboKey(u.locationId, u.modelId);
      const e = g.get(k);
      if (e) e.qty++;
      else {
        const { loc, model } = nameOf(u);
        g.set(k, { locationId: u.locationId, modelId: u.modelId, loc, model, qty: 1 });
      }
    }
    return [...byCycle.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([cycle, m]) => ({
        cycle,
        houses: [...m.values()].reduce((s, r) => s + r.qty, 0),
        rows: [...m.values()].sort((a, b) => a.loc.localeCompare(b.loc) || a.model.localeCompare(b.model)),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, isEquity, catalog]);

  // salva ordenado por ciclo → local → modelo (array cru limpo)
  const sortedUnits = useMemo(
    () =>
      units
        .map((u) => ({ u, ...nameOf(u) }))
        .sort(
          (a, b) => cyc(a.u) - cyc(b.u) || a.loc.localeCompare(b.loc) || a.model.localeCompare(b.model),
        )
        .map((s) => s.u),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [units, isEquity, catalog],
  );

  const addOne = (cycle: number, locationId: string, modelId: string) =>
    setUnits((r) => [...r, { locationId, modelId, cycle: isEquity ? cycle : 1 }]);
  const removeOne = (cycle: number, locationId: string, modelId: string) =>
    setUnits((r) => {
      const i = r.findIndex((u) => cyc(u) === cycle && u.locationId === locationId && u.modelId === modelId);
      if (i < 0) return r;
      const c = [...r];
      c.splice(i, 1);
      return c;
    });
  const removeGroup = (cycle: number, locationId: string, modelId: string) =>
    setUnits((r) => r.filter((u) => !(cyc(u) === cycle && u.locationId === locationId && u.modelId === modelId)));

  const cycleNote = (n: number) => (n === 1 ? "cesta inicial" : `engatilhada na venda do C${n - 1}`);
  const nextCycle = grouped.length ? Math.max(...grouped.map((g) => g.cycle)) + 1 : 1;

  const groupRow = (cycle: number, g: Group) => (
    <div
      key={comboKey(g.locationId, g.modelId)}
      className="flex items-center gap-3 border-b border-slate-50 px-2 py-2 text-sm last:border-0"
    >
      <span className="h-6 w-[3px] rounded-full bg-[#1f3a5f]/70" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-slate-700">{g.model}</div>
        <div className="text-[11px] text-slate-400">{g.loc}</div>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => removeOne(cycle, g.locationId, g.modelId)}
          className="flex h-6 w-6 items-center justify-center rounded border border-slate-300 text-slate-600 hover:bg-slate-100"
        >
          −
        </button>
        <span className="w-5 text-center font-medium text-slate-800">{g.qty}</span>
        <button
          type="button"
          onClick={() => addOne(cycle, g.locationId, g.modelId)}
          className="flex h-6 w-6 items-center justify-center rounded border border-slate-300 text-slate-600 hover:bg-slate-100"
        >
          +
        </button>
      </div>
      <button
        type="button"
        onClick={() => removeGroup(cycle, g.locationId, g.modelId)}
        title="remover modelo do ciclo"
        className="ml-1 text-xs text-slate-300 hover:text-red-500"
      >
        ✕
      </button>
    </div>
  );

  const addBtn = (cycle: number) => (
    <button
      type="button"
      onClick={() => {
        setAddCycle(cycle);
        setAddOpen(true);
      }}
      className="mx-1 mt-1.5 w-[calc(100%-8px)] rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
    >
      + modelo neste ciclo
    </button>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setUnits(initialUnits);
          setSubmitted(false);
          setExpanded({ 1: true });
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
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">Editar cesta</h3>
                <p className="max-w-md text-xs text-slate-400">
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

            <div className="space-y-3 px-6 py-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">
                  {units.length} casa{units.length === 1 ? "" : "s"}
                  {isEquity && grouped.length > 0 ? ` · ${grouped.length} ciclo(s)` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAddCycle(null);
                    setAddOpen(true);
                  }}
                  className="rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#16304f]"
                >
                  + Add house
                </button>
              </div>

              <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-0.5">
                {units.length === 0 && (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-400">
                    Cesta vazia — adicione pelo menos uma casa.
                  </p>
                )}

                {!isEquity && units.length > 0 && (
                  <div className="rounded-xl border border-slate-200">
                    <div className="border-b border-slate-100 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                      Casas · ciclo único
                    </div>
                    <div className="px-1 py-1">
                      {grouped[0]?.rows.map((g) => groupRow(1, g))}
                      {addBtn(1)}
                    </div>
                  </div>
                )}

                {isEquity &&
                  grouped.map((cy) => {
                    const isOpen = expanded[cy.cycle] ?? false;
                    return (
                      <div key={cy.cycle} className="overflow-hidden rounded-xl border border-slate-200">
                        <button
                          type="button"
                          onClick={() => setExpanded((e) => ({ ...e, [cy.cycle]: !isOpen }))}
                          className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${isOpen ? "bg-slate-50" : "bg-white"}`}
                        >
                          <span
                            className="text-[11px] text-slate-400 transition-transform"
                            style={{ transform: isOpen ? "rotate(90deg)" : "none" }}
                          >
                            ▶
                          </span>
                          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#1f3a5f] text-xs font-semibold text-white">
                            {cy.cycle}
                          </span>
                          <span className="flex-1">
                            <span className="block text-sm font-medium text-slate-800">Ciclo {cy.cycle}</span>
                            <span className="block text-[11px] text-slate-400">{cycleNote(cy.cycle)}</span>
                          </span>
                          <span className="text-sm font-medium text-slate-700">{cy.houses} casas</span>
                        </button>
                        {isOpen && (
                          <div className="border-t border-slate-100 px-1 py-1">
                            {cy.rows.map((g) => groupRow(cy.cycle, g))}
                            {addBtn(cy.cycle)}
                          </div>
                        )}
                      </div>
                    );
                  })}

                {isEquity && units.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setAddCycle(nextCycle);
                      setAddOpen(true);
                      setExpanded((e) => ({ ...e, [nextCycle]: true }));
                    }}
                    className="w-full rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-500 hover:bg-slate-50"
                  >
                    + novo ciclo (C{nextCycle})
                  </button>
                )}
              </div>

              {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

              <form
                action={formAction}
                onSubmit={() => setSubmitted(true)}
                className="flex justify-end gap-2 pt-1"
              >
                <input type="hidden" name="simulationId" value={simulationId} />
                {/* salva já ordenado por ciclo → local → modelo (array cru limpo) */}
                <input type="hidden" name="units" value={JSON.stringify(sortedUnits)} />
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
          defaultCycle={addCycle ?? undefined}
          onAdd={(locationId, modelId, qty, cycle) => {
            const c = isEquity ? cycle : 1;
            setUnits((rows) => [
              ...rows,
              ...Array.from({ length: qty }, () => ({ locationId, modelId, cycle: c })),
            ]);
            if (isEquity) setExpanded((e) => ({ ...e, [c]: true }));
            setAddOpen(false);
          }}
          onClose={() => setAddOpen(false)}
        />
      )}
    </>
  );
}
