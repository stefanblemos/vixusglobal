"use client";

import { useState } from "react";
import { mergeParties } from "@/lib/actions/parties";

// Merge manual: numa pessoa (keep), escolhe outro registro que é a MESMA pessoa (drop)
// e mescla nela. Para quando os nomes são divergentes demais para o detector automático.
export function MergePartyInto({
  keepId,
  keepName,
  others,
}: {
  keepId: string;
  keepName: string;
  others: { id: string; name: string }[];
}) {
  const [dropId, setDropId] = useState("");
  const dropName = others.find((o) => o.id === dropId)?.name ?? "";

  return (
    <form
      action={mergeParties}
      onSubmit={(e) => {
        if (!dropId) {
          e.preventDefault();
          return;
        }
        const msg = `Marcar "${dropName}" como a MESMA pessoa que "${keepName}"? As participações, declarações e vendors movem para "${keepName}", o nome "${dropName}" vira alias, e o registro duplicado é removido.`;
        if (!confirm(msg)) e.preventDefault();
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="keepId" value={keepId} />
      <input type="hidden" name="dropId" value={dropId} />
      <div className="min-w-72 flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Mesma pessoa que esta (nome divergente)
        </label>
        <select
          value={dropId}
          onChange={(e) => setDropId(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">— Selecione o registro a mesclar —</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={!dropId}
        className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-50"
      >
        Mesclar nesta
      </button>
    </form>
  );
}
