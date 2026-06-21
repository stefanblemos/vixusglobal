"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setStatementGlAccount } from "@/lib/actions/bank";

export function GlAccountMapper({
  statementId,
  accounts,
  current,
}: {
  statementId: string;
  accounts: string[];
  current: string | null;
}) {
  const [val, setVal] = useState(current ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();

  function save() {
    start(async () => {
      await setStatementGlAccount(statementId, val);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-72 flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Bank account in the GL
        </label>
        <select
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">— Not mapped (matches the whole GL) —</option>
          {accounts.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <button
        onClick={save}
        disabled={pending || !val}
        className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-50"
      >
        {pending
          ? "Re-matching…"
          : val === (current ?? "")
            ? "Re-match"
            : "Map & re-match"}
      </button>
    </div>
  );
}
