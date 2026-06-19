"use client";

import { useState } from "react";
import Link from "next/link";
import type { GroupCompleteness } from "@/lib/tax/group-completeness";

const Mark = ({ ok }: { ok: boolean }) =>
  ok ? (
    <span className="font-medium text-green-600">✓</span>
  ) : (
    <span className="rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-600">missing</span>
  );

export function CompletenessModal({ data }: { data: GroupCompleteness }) {
  const [open, setOpen] = useState(false);
  const clean = data.totalMissing === 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
          clean
            ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
            : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
        }`}
      >
        {clean ? "Data complete ✓" : `Data completeness — ${data.totalMissing} missing`}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4 sm:p-8"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-medium text-slate-800">
                  Data completeness — {data.year}
                </h2>
                <p className="text-sm text-slate-500">
                  Each owner&apos;s number is only accurate if its companies have P&amp;L, BS and GL
                  on file. Missing items in red — go upload them in Documents.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="max-h-[70vh] space-y-5 overflow-auto">
              {data.groups.length === 0 ? (
                <p className="text-sm text-slate-500">No ownership groups to check.</p>
              ) : (
                data.groups.map((g) => (
                  <div key={g.owner}>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-medium text-slate-700">{g.owner}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          g.missing === 0
                            ? "bg-green-50 text-green-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {g.missing === 0 ? "complete" : `${g.missing} missing`}
                      </span>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-slate-500">
                          <tr>
                            <th className="px-3 py-1.5 font-medium">Company</th>
                            <th className="px-3 py-1.5 text-center font-medium">P&amp;L</th>
                            <th className="px-3 py-1.5 text-center font-medium">BS</th>
                            <th className="px-3 py-1.5 text-center font-medium">GL</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {g.companies.map((c) => (
                            <tr
                              key={c.id}
                              className={
                                !c.controlled
                                  ? "text-slate-400"
                                  : !c.pnl || !c.bs || !c.gl
                                    ? "bg-rose-50/30"
                                    : ""
                              }
                            >
                              <td className="px-3 py-1.5">
                                <Link
                                  href={`/companies/${c.id}?tab=financials`}
                                  className={c.controlled ? "text-[#1f3a5f] hover:underline" : "hover:underline"}
                                >
                                  {c.name}
                                </Link>
                              </td>
                              {c.controlled ? (
                                <>
                                  <td className="px-3 py-1.5 text-center">
                                    <Mark ok={c.pnl} />
                                  </td>
                                  <td className="px-3 py-1.5 text-center">
                                    <Mark ok={c.bs} />
                                  </td>
                                  <td className="px-3 py-1.5 text-center">
                                    <Mark ok={c.gl} />
                                  </td>
                                </>
                              ) : (
                                <td colSpan={3} className="px-3 py-1.5 text-center text-xs text-slate-400">
                                  external — controlled elsewhere (still a partner)
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <Link
                href="/import"
                className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]"
              >
                Go to Documents
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
