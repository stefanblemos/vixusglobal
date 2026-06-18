"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { saveYearNote } from "@/lib/actions/year-note";

function SaveButton({ dirty }: { dirty: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !dirty}
      className="rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#16304f] disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save note"}
    </button>
  );
}

// Campo de notas por empresa/ano — para justificar divergências que não fecham sozinhas
// (ex.: distribuição com estrutura diferente no QBO, topo da cadeia sem contraparte).
export function YearNoteField({
  companyId,
  year,
  initialBody,
  updatedLabel,
}: {
  companyId: string;
  year: number;
  initialBody: string;
  updatedLabel: string | null;
}) {
  const [dirty, setDirty] = useState(false);

  return (
    <div>
      <div className="mb-1 text-sm font-medium text-slate-700">
        Notes — justify reconciliation differences ({year})
      </div>
      <form action={saveYearNote} onSubmit={() => setDirty(false)}>
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="year" value={year} />
        <textarea
          name="body"
          defaultValue={initialBody}
          onChange={() => setDirty(true)}
          rows={4}
          placeholder="Why does a number not match? e.g. 'Vixus books the $10,769 distribution under the 1099 account split to its owners, not a Profit Sharing Distribution section — so the QBO cross-match shows differs. Confirmed correct.'"
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 outline-none focus:border-[#1f3a5f] focus:ring-1 focus:ring-[#1f3a5f]"
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {updatedLabel ? `Last saved ${updatedLabel}` : "Not saved yet"}
          </span>
          <SaveButton dirty={dirty} />
        </div>
      </form>
    </div>
  );
}
