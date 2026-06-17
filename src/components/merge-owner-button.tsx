"use client";

import { mergeParties } from "@/lib/actions/parties";

// Botão de mesclar donos duplicados. Quando o match é só por nome (não por SSN), pede
// confirmação explícita antes de mesclar ("perguntar se ver similaridade").
export function MergeOwnerButton({
  keepId,
  dropId,
  keepName,
  dropName,
  confirmNeeded,
}: {
  keepId: string;
  dropId: string;
  keepName: string;
  dropName: string;
  confirmNeeded: boolean;
}) {
  return (
    <form
      action={mergeParties}
      onSubmit={(e) => {
        const msg = confirmNeeded
          ? `"${dropName}" and "${keepName}" have similar names but no matching SSN. Are they the same person? This will merge "${dropName}" into "${keepName}".`
          : `Merge "${dropName}" into "${keepName}"? Holdings and returns move to "${keepName}" and the duplicate is removed.`;
        if (!confirm(msg)) e.preventDefault();
      }}
    >
      <input type="hidden" name="keepId" value={keepId} />
      <input type="hidden" name="dropId" value={dropId} />
      <button className="rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#16304f]">
        Merge into {keepName}
      </button>
    </form>
  );
}
