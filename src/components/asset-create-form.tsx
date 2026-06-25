"use client";

import { useActionState, useMemo, useState } from "react";
import { createAsset, type AssetFormState } from "@/lib/actions/assets";
import { ASSET_CATEGORIES, categoryByKey } from "@/lib/assets/categories";
import { PT_ASSET_CATEGORIES, ptCategoryByKey } from "@/lib/assets/pt-categories";

const input =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#8DC63F] focus:ring-2 focus:ring-[#8DC63F]/30";
const label = "mb-1 block text-xs font-medium text-slate-600";

type Co = { id: string; legalName: string; jurisdiction: string; baseCurrency: string };

export function AssetCreateForm({ companies }: { companies: Co[] }) {
  const [state, action, pending] = useActionState<AssetFormState, FormData>(createAsset, undefined);
  const [companyId, setCompanyId] = useState("");
  const [usCategory, setUsCategory] = useState("EQUIPMENT");
  const [ptCategory, setPtCategory] = useState("BUILDING_COMM");

  const company = useMemo(() => companies.find((c) => c.id === companyId), [companies, companyId]);
  // Regime segue a jurisdição da empresa: PT → quotas constantes; senão MACRS (US).
  const regime = company?.jurisdiction === "PT" ? "PT" : "US";
  const usCat = categoryByKey(usCategory);
  const ptCat = ptCategoryByKey(ptCategory);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="regime" value={regime} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className={label}>Company *</label>
          <select
            name="companyId"
            required
            className={input}
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
          >
            <option value="" disabled>
              Select…
            </option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
                {c.jurisdiction === "PT" ? "  (PT · €)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Asset name *</label>
          <input
            name="name"
            required
            placeholder={regime === "PT" ? "ex.: Imóvel Campolide" : "e.g. Ford F-150"}
            className={input}
          />
        </div>
      </div>

      {regime === "PT" ? (
        // ── Portugal: quotas constantes (DR 25/2009) ──
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className={label}>Tipo de ativo</label>
              <select
                name="category"
                value={ptCategory}
                onChange={(e) => setPtCategory(e.target.value)}
                className={input}
              >
                {PT_ASSET_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Entrada em uso *</label>
              <input name="acquisitionDate" type="date" required className={input} />
            </div>
            <div>
              <label className={label}>Custo total *</label>
              <input name="cost" inputMode="decimal" placeholder="0.00" className={input} />
            </div>
            <div>
              <label className={label}>Taxa anual (%)</label>
              <input
                name="ratePct"
                key={ptCategory}
                defaultValue={ptCat.ratePct}
                inputMode="decimal"
                className={input}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className={label}>
                Valor do terreno {ptCat.isBuilding ? "" : "(s/ aplicação)"}
              </label>
              <input
                name="landValue"
                inputMode="decimal"
                placeholder="0.00"
                className={input}
                disabled={!ptCat.isBuilding}
              />
            </div>
            <div className="md:col-span-3">
              <label className={label}>Notas</label>
              <input name="notes" className={input} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              Quotas constantes — {ptCat.ratePct}% ao ano{ptCat.hint ? ` (${ptCat.hint})` : ""}.
              {ptCat.isBuilding ? " O terreno não deprecia — informe a parcela." : ""} Moeda:{" "}
              {company?.baseCurrency ?? "EUR"}.
            </p>
            <SubmitBtn pending={pending} />
          </div>
        </>
      ) : (
        // ── EUA: MACRS / §179 / bonus ──
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className={label}>Type</label>
              <select
                name="category"
                value={usCategory}
                onChange={(e) => setUsCategory(e.target.value)}
                className={input}
              >
                {ASSET_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Acquired (in service) *</label>
              <input name="acquisitionDate" type="date" required className={input} />
            </div>
            <div>
              <label className={label}>Cost *</label>
              <input name="cost" inputMode="decimal" placeholder="0.00" className={input} />
            </div>
            <div>
              <label className={label}>Recovery (years)</label>
              <input
                name="recoveryYears"
                key={usCategory}
                defaultValue={usCat.recoveryYears}
                inputMode="decimal"
                className={input}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className={label}>§179 amount</label>
              <input name="section179" inputMode="decimal" placeholder="0.00" className={input} />
            </div>
            <div>
              <label className={label}>Bonus %</label>
              <input name="bonusPct" inputMode="decimal" placeholder="0" className={input} />
            </div>
            <div className="md:col-span-2">
              <label className={label}>Notes</label>
              <input name="notes" className={input} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              {usCat.method === "SL_MM"
                ? "Real property → straight-line, mid-month."
                : `MACRS ${usCat.recoveryYears}-yr, half-year convention.`}
              {usCat.hint ? ` ${usCat.hint}.` : ""}
            </p>
            <SubmitBtn pending={pending} />
          </div>
        </>
      )}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

function SubmitBtn({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-50"
    >
      {pending ? "Saving…" : "Add asset"}
    </button>
  );
}
