"use client";

import { useTransition } from "react";
import { lockYear, unlockYear } from "@/lib/actions/year-close";

export function YearCloseControls({
  companyId,
  year,
  locked,
  lockedAt,
  lockedBy,
  unreconciledCount,
  alertCount,
}: {
  companyId: string;
  year: number;
  locked: boolean;
  lockedAt: string | null;
  lockedBy: string | null;
  unreconciledCount: number;
  alertCount: number;
}) {
  const [pending, start] = useTransition();

  const submit = (action: (fd: FormData) => Promise<void>) => {
    const fd = new FormData();
    fd.set("companyId", companyId);
    fd.set("year", String(year));
    start(() => action(fd));
  };

  if (!locked) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex-1">
          <div className="text-sm font-medium text-slate-800">Year open</div>
          <div className="text-xs text-slate-500">
            {unreconciledCount > 0
              ? `${unreconciledCount} unreconciled difference${unreconciledCount > 1 ? "s" : ""} — review before locking.`
              : "Reconciliation is clean. Lock to freeze the partners, tax treatment and key figures as the reference."}
          </div>
        </div>
        <button
          onClick={() => submit(lockYear)}
          disabled={pending}
          className="rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#16314f] disabled:opacity-50"
        >
          {pending ? "Locking…" : "🔒 Lock year"}
        </button>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${
        alertCount > 0 ? "border-red-200 bg-red-50/50" : "border-emerald-200 bg-emerald-50/40"
      }`}
    >
      <div className="flex-1">
        <div className="text-sm font-medium text-slate-800">
          🔒 Year locked
          {alertCount > 0 && (
            <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
              {alertCount} alert{alertCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500">
          Locked {lockedAt ? new Date(lockedAt).toLocaleDateString("en-US") : ""}
          {lockedBy ? ` by ${lockedBy}` : ""}. The filed return is checked against this baseline.
        </div>
      </div>
      <button
        onClick={() => {
          if (confirm(`Reopen ${year}? This removes the locked baseline.`)) submit(unlockYear);
        }}
        disabled={pending}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
      >
        {pending ? "Reopening…" : "Reopen year"}
      </button>
    </div>
  );
}
