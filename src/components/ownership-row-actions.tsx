"use client";

import { useState } from "react";
import { endOwnership, reopenOwnership, deleteOwnership } from "@/lib/actions/ownership";

// Ações de um vínculo de ownership: encerrar numa data (saída de sócio, preserva
// histórico), reabrir (corrige saída errada) ou remover de vez (corrige lançamento).
export function OwnershipRowActions({
  ownershipId,
  companyId,
  ended,
  defaultEndDate,
}: {
  ownershipId: string;
  companyId: string;
  ended: boolean;
  defaultEndDate: string;
}) {
  const [showEnd, setShowEnd] = useState(false);

  return (
    <div className="flex items-center justify-end gap-2 text-xs">
      {showEnd ? (
        <form action={endOwnership} className="flex items-center gap-1">
          <input type="hidden" name="ownershipId" value={ownershipId} />
          <input type="hidden" name="companyId" value={companyId} />
          <input
            type="date"
            name="endDate"
            defaultValue={defaultEndDate}
            className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"
          />
          <button className="rounded bg-[#1f3a5f] px-2 py-0.5 text-white hover:bg-[#16314f]">
            End
          </button>
          <button
            type="button"
            onClick={() => setShowEnd(false)}
            className="text-slate-400 hover:text-slate-600"
          >
            cancel
          </button>
        </form>
      ) : (
        <>
          {ended ? (
            <form action={reopenOwnership}>
              <input type="hidden" name="ownershipId" value={ownershipId} />
              <input type="hidden" name="companyId" value={companyId} />
              <button className="text-slate-500 hover:text-[#1f3a5f]">Reopen</button>
            </form>
          ) : (
            <button
              onClick={() => setShowEnd(true)}
              className="text-slate-500 hover:text-[#1f3a5f]"
            >
              End on date
            </button>
          )}
          <form
            action={deleteOwnership}
            onSubmit={(e) => {
              if (
                !confirm(
                  "Remove this ownership record entirely? Use 'End on date' to record an exit instead.",
                )
              )
                e.preventDefault();
            }}
          >
            <input type="hidden" name="ownershipId" value={ownershipId} />
            <input type="hidden" name="companyId" value={companyId} />
            <button className="text-slate-400 hover:text-red-600">Remove</button>
          </form>
        </>
      )}
    </div>
  );
}
