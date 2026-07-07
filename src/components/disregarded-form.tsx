"use client";

import { useState } from "react";
import { setDisregardedInto } from "@/lib/actions/companies";

// Marca a empresa como DESCONSIDERADA (disregarded SMLLC) declarada DENTRO de outra — o resultado dela é
// consolidado no IR da dona e ela deixa de ser cobrada como "IR faltando". Fonte única: Company.disregardedIntoId.
export function DisregardedForm({
  companyId,
  currentParentId,
  currentParentName,
  candidates,
}: {
  companyId: string;
  currentParentId: string | null;
  currentParentName: string | null;
  candidates: { id: string; legalName: string }[];
}) {
  const [value, setValue] = useState(currentParentId ?? "");

  return (
    <form action={setDisregardedInto} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="companyId" value={companyId} />
      <span className="text-slate-500">Disregarded — reported inside:</span>
      <select
        name="disregardedIntoId"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded border border-slate-300 px-2 py-1"
      >
        <option value="">— not disregarded (files its own return) —</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.legalName}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={value === (currentParentId ?? "")}
        className="rounded bg-slate-800 px-3 py-1 text-white disabled:opacity-40"
      >
        Save
      </button>
      {currentParentName && (
        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">
          folds into {currentParentName}
        </span>
      )}
    </form>
  );
}
