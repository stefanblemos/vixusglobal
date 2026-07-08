"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import {
  deleteModel,
  deleteModelLocation,
  saveModel,
  saveModelLocation,
  type CatalogFormState,
} from "@/lib/actions/catalog";
import type { HistoryEntry } from "@/components/catalog-locations";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";
const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";
const td = "px-3 py-2.5 text-sm text-slate-600";

export const HOUSE_TYPE_LABEL: Record<string, string> = {
  AFFORDABLE: "Affordable",
  MID_RANGE: "Mid-range",
  UPPER_MIDDLE: "Upper-middle",
  HIGH_END: "High-end",
  LUXURY: "Luxury",
  DUPLEX: "Duplex",
  TRIPLEX: "Triplex",
  MULTIFAMILY: "Multifamily",
};

export type ModelRow = {
  id: string;
  name: string;
  houseType: string;
  buildMonths: string;
  contractorFee: string | null;
  notes: string | null;
  locations: Array<{
    id: string; // CatalogModelLocation id
    locationId: string;
    locationName: string;
    salePrice: string;
    costPerformance: string | null;
    costContractor: string | null;
    locationLotEstimate: string | null;
  }>;
};

const money = (v: string | number | null) =>
  v == null || v === "" ? "—" : `$${Number(v).toLocaleString("en-US")}`;

// Edição dos valores do modelo em UM local (abre ao clicar na location dentro do modal).
function ModelLocationEditor({
  modelId,
  loc,
  onDone,
}: {
  modelId: string;
  loc: ModelRow["locations"][number];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<CatalogFormState, FormData>(
    saveModelLocation,
    undefined,
  );
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
      <input type="hidden" name="modelId" value={modelId} />
      <input type="hidden" name="locationId" value={loc.locationId} />
      <input type="hidden" name="id" value={loc.id} />
      <div className="w-32">
        <label className={labelClass}>Sale price *</label>
        <input name="salePrice" defaultValue={loc.salePrice} required className={inputClass} />
      </div>
      <div className="w-32">
        <label className={labelClass}>Cost (performance)</label>
        <input name="costPerformance" defaultValue={loc.costPerformance ?? ""} className={inputClass} />
      </div>
      <div className="w-36">
        <label className={labelClass}>Cost (contractor base)</label>
        <input name="costContractor" defaultValue={loc.costContractor ?? ""} placeholder="sem o fee" className={inputClass} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save values"}
      </button>
      <button
        type="submit"
        formAction={deleteModelLocation}
        className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-500 hover:bg-red-50"
      >
        Remove from location
      </button>
      <button
        type="button"
        onClick={onDone}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
      >
        Close
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

// Vincula o modelo a um local novo.
function AddModelLocation({
  modelId,
  available,
}: {
  modelId: string;
  available: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState<CatalogFormState, FormData>(
    saveModelLocation,
    undefined,
  );
  if (available.length === 0) return null;
  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3">
      <input type="hidden" name="modelId" value={modelId} />
      <div className="w-40">
        <label className={labelClass}>Add to location</label>
        <select name="locationId" defaultValue="" required className={inputClass}>
          <option value="" disabled>
            Select…
          </option>
          {available.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="w-32">
        <label className={labelClass}>Sale price *</label>
        <input name="salePrice" required className={inputClass} />
      </div>
      <div className="w-32">
        <label className={labelClass}>Cost (performance)</label>
        <input name="costPerformance" className={inputClass} />
      </div>
      <div className="w-36">
        <label className={labelClass}>Cost (contractor base)</label>
        <input name="costContractor" placeholder="sem o fee" className={inputClass} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
      >
        {pending ? "Adding…" : "+ Add"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

function ModelModal({
  model,
  allLocations,
  typeFees,
  history,
  onClose,
}: {
  model: ModelRow | null;
  allLocations: Array<{ id: string; name: string }>;
  typeFees: Record<string, string>;
  history: HistoryEntry[];
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<CatalogFormState, FormData>(
    saveModel,
    undefined,
  );
  const [openLoc, setOpenLoc] = useState<string | null>(null);
  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  const linked = new Set(model?.locations.map((l) => l.locationId) ?? []);
  const available = allLocations.filter((l) => !linked.has(l.id));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6"
      onClick={onClose}
    >
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-800">{model ? model.name : "New model"}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <form action={formAction} className="space-y-4 px-6 py-4">
          {model && <input type="hidden" name="id" value={model.id} />}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="mod-name" className={labelClass}>Name *</label>
              <input id="mod-name" name="name" required defaultValue={model?.name ?? ""} className={inputClass} />
            </div>
            <div>
              <label htmlFor="mod-type" className={labelClass}>House type</label>
              <select id="mod-type" name="houseType" defaultValue={model?.houseType ?? "MID_RANGE"} className={inputClass}>
                {Object.entries(HOUSE_TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="mod-months" className={labelClass}>Build months</label>
              <input id="mod-months" name="buildMonths" defaultValue={model?.buildMonths ?? "4"} className={inputClass} />
            </div>
            <div>
              <label htmlFor="mod-fee" className={labelClass}>Contractor fee override</label>
              <input
                id="mod-fee"
                name="contractorFee"
                defaultValue={model?.contractorFee ?? ""}
                placeholder={
                  model ? `tipo: ${money(typeFees[model.houseType] ?? "0")}` : "blank = fee do tipo"
                }
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="mod-notes" className={labelClass}>Notes</label>
              <input id="mod-notes" name="notes" defaultValue={model?.notes ?? ""} className={inputClass} />
            </div>
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

          <div className="flex items-center justify-between pt-1">
            {model ? (
              <button
                type="submit"
                formAction={deleteModel}
                className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-500 hover:bg-red-50"
              >
                Delete model
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>

        {model && (
          <div className="border-t border-slate-100 px-6 py-4">
            <h4 className="mb-2 text-sm font-semibold text-slate-700">
              Locations ({model.locations.length}) — click to adjust values
            </h4>
            <div className="space-y-1">
              {model.locations.map((loc) => (
                <div key={loc.id}>
                  <button
                    type="button"
                    onClick={() => setOpenLoc(openLoc === loc.id ? null : loc.id)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                      openLoc === loc.id
                        ? "border-[#1f3a5f]/40 bg-[#1f3a5f]/[0.04]"
                        : "border-slate-100 hover:border-slate-300"
                    }`}
                  >
                    <span className="font-medium text-slate-700">{loc.locationName}</span>
                    <span className="text-xs text-slate-500">
                      venda {money(loc.salePrice)} · perf {money(loc.costPerformance)} · contractor{" "}
                      {money(loc.costContractor)}
                      {loc.costContractor != null && " + fee"} · lote {money(loc.locationLotEstimate)}
                    </span>
                  </button>
                  {openLoc === loc.id && (
                    <ModelLocationEditor modelId={model.id} loc={loc} onDone={() => setOpenLoc(null)} />
                  )}
                </div>
              ))}
              {model.locations.length === 0 && (
                <p className="text-xs text-slate-400">Not available in any location yet.</p>
              )}
            </div>
            <AddModelLocation modelId={model.id} available={available} />
          </div>
        )}

        {model && (
          <div className="border-t border-slate-100 px-6 py-4">
            <h4 className="mb-2 text-sm font-semibold text-slate-700">Change history</h4>
            {history.length === 0 ? (
              <p className="text-xs text-slate-400">No changes recorded yet.</p>
            ) : (
              <div className="max-h-48 space-y-2 overflow-y-auto pr-2">
                {history.map((h, i) => (
                  <div key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                    <div className="flex justify-between text-slate-400">
                      <span>
                        {h.action === "CREATE" ? "Created" : h.action === "DELETE" ? "Deleted" : "Updated"} by{" "}
                        <span className="font-medium text-slate-600">{h.changedBy}</span>
                      </span>
                      <span>{new Date(h.createdAt).toLocaleString("en-US")}</span>
                    </div>
                    {h.changes.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-slate-600">
                        {h.changes.map((c, j) => (
                          <li key={j}>
                            {c.field}: <span className="text-slate-400 line-through">{c.from ?? "—"}</span> →{" "}
                            <span className="font-medium">{c.to ?? "—"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CatalogModels({
  models,
  allLocations,
  typeFees,
  history,
}: {
  models: ModelRow[];
  allLocations: Array<{ id: string; name: string }>;
  typeFees: Record<string, string>;
  history: HistoryEntry[];
}) {
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const current = selected === "new" ? null : models.find((m) => m.id === selected) ?? null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-base font-medium text-slate-800">House models</h2>
          <p className="text-xs text-slate-400">
            Click a model to edit its data and per-location values — all changes are logged.
          </p>
        </div>
        <button
          onClick={() => setSelected("new")}
          className="rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#16304f]"
        >
          + New model
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className={th}>Model</th>
              <th className={th}>Type</th>
              <th className={th}>Months</th>
              <th className={th}>Contractor fee</th>
              <th className={th}>Locations</th>
            </tr>
          </thead>
          <tbody>
            {models.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-sm text-slate-400">
                  No models yet.
                </td>
              </tr>
            )}
            {models.map((m) => (
              <tr
                key={m.id}
                onClick={() => setSelected(m.id)}
                className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/70"
              >
                <td className={`${td} font-medium text-slate-800`}>{m.name}</td>
                <td className={td}>{HOUSE_TYPE_LABEL[m.houseType] ?? m.houseType}</td>
                <td className={td}>{m.buildMonths}</td>
                <td className={td}>
                  {m.contractorFee != null ? (
                    money(m.contractorFee)
                  ) : (
                    <span className="text-xs text-slate-400">
                      {money(typeFees[m.houseType] ?? "0")} (type)
                    </span>
                  )}
                </td>
                <td className={td}>
                  <span className="text-xs text-slate-500">
                    {m.locations.map((l) => l.locationName).join(", ") || "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected !== null && (
        <ModelModal
          model={current}
          allLocations={allLocations}
          typeFees={typeFees}
          history={history.filter((h) => current && h.entityId === current.id)}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
