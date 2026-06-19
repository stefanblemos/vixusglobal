"use client";

import { useState } from "react";
import { addReserveDeposit, deleteReserveDeposit } from "@/lib/actions/reserve";

const usd = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);

export interface DepositRow {
  id: string;
  company: string;
  quarter: number;
  amount: number;
  depositedAt: string | null;
  note: string | null;
}

export function ReserveDepositModal({
  year,
  companies,
  deposits,
}: {
  year: number;
  companies: { id: string; name: string }[];
  deposits: DepositRow[];
}) {
  const [open, setOpen] = useState(false);
  const input =
    "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#8DC63F] focus:ring-2 focus:ring-[#8DC63F]/30";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        + Record deposit
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4 sm:p-8"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-medium text-slate-800">Reserve deposits — {year}</h2>
                <p className="text-sm text-slate-500">
                  Record cash actually moved into the tax-reserve account, by quarter.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <form action={addReserveDeposit} className="grid grid-cols-2 gap-3 md:grid-cols-6">
              <input type="hidden" name="year" value={year} />
              <select name="companyId" required className={`${input} col-span-2`} defaultValue="">
                <option value="" disabled>
                  Company…
                </option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select name="quarter" required className={input} defaultValue="">
                <option value="" disabled>
                  Qtr…
                </option>
                <option value="1">Q1</option>
                <option value="2">Q2</option>
                <option value="3">Q3</option>
                <option value="4">Q4</option>
              </select>
              <input name="amount" inputMode="decimal" placeholder="Amount" required className={input} />
              <input name="depositedAt" type="date" className={input} />
              <button
                type="submit"
                className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]"
              >
                Add
              </button>
              <input name="note" placeholder="Note (optional)" className={`${input} col-span-2 md:col-span-6`} />
            </form>

            <div className="mt-5 max-h-[50vh] overflow-auto">
              {deposits.length === 0 ? (
                <p className="text-sm text-slate-400">No deposits recorded for {year} yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">Company</th>
                      <th className="px-3 py-1.5 font-medium">Qtr</th>
                      <th className="px-3 py-1.5 font-medium">Date</th>
                      <th className="px-3 py-1.5 text-right font-medium">Amount</th>
                      <th className="px-3 py-1.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {deposits.map((d) => (
                      <tr key={d.id}>
                        <td className="px-3 py-1.5 text-slate-700">
                          {d.company}
                          {d.note && <span className="ml-1 text-xs text-slate-400">· {d.note}</span>}
                        </td>
                        <td className="px-3 py-1.5 text-slate-500">Q{d.quarter}</td>
                        <td className="px-3 py-1.5 text-slate-500">{d.depositedAt ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">{usd(d.amount)}</td>
                        <td className="px-3 py-1.5 text-right">
                          <form action={deleteReserveDeposit}>
                            <input type="hidden" name="id" value={d.id} />
                            <button className="text-xs text-slate-300 hover:text-red-600" title="Delete">
                              ✕
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
