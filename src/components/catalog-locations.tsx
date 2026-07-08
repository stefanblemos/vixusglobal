"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { deleteLocation, saveLocation, type CatalogFormState } from "@/lib/actions/catalog";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";
const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";
const td = "px-3 py-2.5 text-sm text-slate-600";

export type LocationRow = {
  id: string;
  name: string;
  permitDays: number;
  lotLeadDays: number;
  saleDays: number;
  lotCostEstimate: string | null;
  notes: string | null;
  models: Array<{ name: string; salePrice: string; lotCost: string | null }>;
};

export type HistoryEntry = {
  entityId: string;
  action: string;
  changedBy: string;
  createdAt: string; // ISO
  changes: Array<{ field: string; from: string | null; to: string | null }>;
};

const FIELD_LABEL: Record<string, string> = {
  name: "Name",
  permitDays: "Permit days",
  lotLeadDays: "Lot lead days",
  saleDays: "Sale days",
  lotCostEstimate: "Lot cost (est.)",
  notes: "Notes",
};

const money = (v: string | null) =>
  v == null || v === "" ? "—" : `$${Number(v).toLocaleString("en-US")}`;

function LocationModal({
  location,
  history,
  onClose,
}: {
  location: LocationRow | null; // null = criar nova
  history: HistoryEntry[];
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<CatalogFormState, FormData>(
    saveLocation,
    undefined,
  );
  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-800">
            {location ? location.name : "New location"}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <form action={formAction} className="space-y-4 px-6 py-4">
          {location && <input type="hidden" name="id" value={location.id} />}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <div className="col-span-2 md:col-span-1">
              <label htmlFor="loc-name" className={labelClass}>Name *</label>
              <input id="loc-name" name="name" required defaultValue={location?.name ?? ""} className={inputClass} />
            </div>
            <div>
              <label htmlFor="loc-permit" className={labelClass}>Permit days</label>
              <input id="loc-permit" name="permitDays" defaultValue={location?.permitDays ?? 45} className={inputClass} />
            </div>
            <div>
              <label htmlFor="loc-lotlead" className={labelClass}>Lot lead days</label>
              <input id="loc-lotlead" name="lotLeadDays" defaultValue={location?.lotLeadDays ?? 30} className={inputClass} />
            </div>
            <div>
              <label htmlFor="loc-sale" className={labelClass}>Sale days</label>
              <input id="loc-sale" name="saleDays" defaultValue={location?.saleDays ?? 60} className={inputClass} />
            </div>
            <div>
              <label htmlFor="loc-lotcost" className={labelClass}>Lot cost (est.)</label>
              <input id="loc-lotcost" name="lotCostEstimate" defaultValue={location?.lotCostEstimate ?? ""} className={inputClass} />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label htmlFor="loc-notes" className={labelClass}>Notes</label>
              <input id="loc-notes" name="notes" defaultValue={location?.notes ?? ""} className={inputClass} />
            </div>
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

          <div className="flex items-center justify-between pt-1">
            {location ? (
              <button
                type="submit"
                formAction={deleteLocation}
                className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-500 hover:bg-red-50"
              >
                Delete location
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

        {location && (
          <div className="border-t border-slate-100 px-6 py-4">
            <h4 className="mb-2 text-sm font-semibold text-slate-700">
              Models available here ({location.models.length})
            </h4>
            {location.models.length === 0 ? (
              <p className="text-xs text-slate-400">
                No models linked — set sale prices in the House models section.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {location.models.map((m) => (
                  <span key={m.name} className="rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-600">
                    {m.name} · venda {money(m.salePrice)}
                    {m.lotCost != null && ` · lote ${money(m.lotCost)}`}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {location && (
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
                            {FIELD_LABEL[c.field] ?? c.field}:{" "}
                            <span className="text-slate-400 line-through">{c.from ?? "—"}</span>{" "}
                            → <span className="font-medium">{c.to ?? "—"}</span>
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

export function CatalogLocations({
  locations,
  history,
}: {
  locations: LocationRow[];
  history: HistoryEntry[];
}) {
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const current = selected === "new" ? null : locations.find((l) => l.id === selected) ?? null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-base font-medium text-slate-800">Locations</h2>
          <p className="text-xs text-slate-400">
            Click a row to edit — every change is logged with who and when.
          </p>
        </div>
        <button
          onClick={() => setSelected("new")}
          className="rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#16304f]"
        >
          + New location
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className={th}>Name</th>
              <th className={th}>Permit days</th>
              <th className={th}>Lot lead</th>
              <th className={th}>Sale days</th>
              <th className={th}>Lot cost (est.)</th>
              <th className={th}>Models</th>
            </tr>
          </thead>
          <tbody>
            {locations.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-sm text-slate-400">
                  No locations yet.
                </td>
              </tr>
            )}
            {locations.map((l) => (
              <tr
                key={l.id}
                onClick={() => setSelected(l.id)}
                className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/70"
              >
                <td className={`${td} font-medium text-slate-800`}>{l.name}</td>
                <td className={td}>{l.permitDays}</td>
                <td className={td}>{l.lotLeadDays}</td>
                <td className={td}>{l.saleDays}</td>
                <td className={td}>{money(l.lotCostEstimate)}</td>
                <td className={td}>
                  {l.models.length === 0 ? (
                    <span className="text-xs text-slate-300">none</span>
                  ) : (
                    <span className="text-xs text-slate-500">
                      {l.models.map((m) => m.name).join(", ")}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected !== null && (
        <LocationModal
          location={current}
          history={history.filter((h) => current && h.entityId === current.id)}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
