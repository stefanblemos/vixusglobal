"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createPool, updatePool, type FormState } from "@/lib/actions/pools";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export type PoolFormValues = {
  id?: string;
  code: string;
  name: string;
  alias: string;
  status?: string;
  unitPrice: string;
  targetAmount: string;
  profitSharePct: string; // performance da 4U em % na UI (35); banco guarda a fração do investidor (0.65)
  profitShareTiming: string;
  fundingDeadline: string; // yyyy-mm-dd
  startDate: string;
  plannedEndDate: string;
  effectiveEndDate: string;
  companyId: string; // entidade (Company) do pool — "" = não vinculada
  noteLoanId: string; // nota participativa (IntercompanyLoan) — "" = nenhuma
  notes: string;
};

// Form único de pool: sem `values.id` cria; com id edita (inclui status + entidade).
export function PoolForm({
  values,
  companies = [],
  noteLoans = [],
}: {
  values: PoolFormValues;
  companies?: Array<{ id: string; name: string }>;
  noteLoans?: Array<{ id: string; label: string }>;
}) {
  const action = values.id ? updatePool.bind(null, values.id) : createPool;
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, undefined);
  const editing = Boolean(values.id);

  return (
    // key = valores atuais (edição fica montada após o save): dados novos remontam o form —
    // sem isso o form reset do React 19 deixava valores antigos na tela
    <form
      key={editing ? JSON.stringify(values) : undefined}
      action={formAction}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-6"
    >
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <label htmlFor="code" className={labelClass}>
            Code *
          </label>
          <input id="code" name="code" required defaultValue={values.code} className={inputClass} />
        </div>
        <div className="col-span-2">
          <label htmlFor="name" className={labelClass}>
            Legal name *
          </label>
          <input
            id="name"
            name="name"
            required
            defaultValue={values.name}
            placeholder="Vixus Home Partners I LLC"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="alias" className={labelClass}>
            Project alias
          </label>
          <input
            id="alias"
            name="alias"
            defaultValue={values.alias}
            placeholder="PH3"
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <label htmlFor="unitPrice" className={labelClass}>
            Unit price
          </label>
          <input id="unitPrice" name="unitPrice" defaultValue={values.unitPrice} className={inputClass} />
        </div>
        <div>
          <label htmlFor="targetAmount" className={labelClass}>
            Funding target
          </label>
          <input
            id="targetAmount"
            name="targetAmount"
            defaultValue={values.targetAmount}
            placeholder="600,000"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="profitSharePct" className={labelClass}>
            Performance da 4U (% do lucro)
          </label>
          <input
            id="profitSharePct"
            name="profitSharePct"
            defaultValue={values.profitSharePct}
            placeholder="35"
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-slate-400">
            Fatia do LUCRO que fica com a 4U. O restante vai aos investidores — é o que o app
            desconta na projeção de fim. Renegociou para menos? Baixe aqui e o retorno sobe.
          </p>
        </div>
        <div>
          <label htmlFor="profitShareTiming" className={labelClass}>
            Profit paid at
          </label>
          <select
            id="profitShareTiming"
            name="profitShareTiming"
            defaultValue={values.profitShareTiming}
            className={inputClass}
          >
            <option value="">—</option>
            <option value="PER_SALE">Each sale</option>
            <option value="PROJECT_COMPLETION">Project completion</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <label htmlFor="fundingDeadline" className={labelClass}>
            Funding deadline
          </label>
          <input
            id="fundingDeadline"
            name="fundingDeadline"
            type="date"
            defaultValue={values.fundingDeadline}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="startDate" className={labelClass}>
            Project start
          </label>
          <input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={values.startDate}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="plannedEndDate" className={labelClass}>
            Planned end
          </label>
          <input
            id="plannedEndDate"
            name="plannedEndDate"
            type="date"
            defaultValue={values.plannedEndDate}
            className={inputClass}
          />
        </div>
        {editing && (
          <div>
            <label htmlFor="effectiveEndDate" className={labelClass}>
              Effective end
            </label>
            <input
              id="effectiveEndDate"
              name="effectiveEndDate"
              type="date"
              defaultValue={values.effectiveEndDate}
              className={inputClass}
            />
          </div>
        )}
        {editing && (
          <div>
            <label htmlFor="status" className={labelClass}>
              Status
            </label>
            <select id="status" name="status" defaultValue={values.status} className={inputClass}>
              <option value="FUNDING">Funding</option>
              <option value="ACTIVE">Active</option>
              <option value="CLOSING">Closing</option>
              <option value="CLOSED">Closed</option>
            </select>
          </div>
        )}
        {editing && companies.length > 0 && (
          <div className="col-span-2">
            <label htmlFor="companyId" className={labelClass} title="A empresa (Company) dona do pool — some o badge 'entidade não vinculada'">
              Entity (company)
            </label>
            <select id="companyId" name="companyId" defaultValue={values.companyId} className={inputClass}>
              <option value="">— not linked</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {editing && noteLoans.length > 0 && (
          <div className="col-span-2">
            <label htmlFor="noteLoanId" className={labelClass} title="Nota participativa (intercompany) ligada ao pool, se houver">
              Participation note
            </label>
            <select id="noteLoanId" name="noteLoanId" defaultValue={values.noteLoanId} className={inputClass}>
              <option value="">— none</option>
              {noteLoans.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="notes" className={labelClass}>
          Notes
        </label>
        <textarea id="notes" name="notes" rows={2} defaultValue={values.notes} className={inputClass} />
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Link
          href={values.id ? `/pools/${values.id}` : "/pools"}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
        >
          {pending ? "Saving…" : editing ? "Save pool" : "Create pool"}
        </button>
      </div>
      {!editing && (
        <p className="text-xs text-slate-400">
          After creating, add the houses (pro forma + bank terms), then the members and their
          contributions. The cap table percentages are always derived from units.
        </p>
      )}
    </form>
  );
}
