"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getMatchCandidates, matchLine, reviewLine, type MatchCandidate } from "@/lib/actions/bank";

interface Line {
  id: string;
  date: string;
  description: string;
  amount: string;
}

const usd = (v: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(v));

export function BankReview({ lines }: { lines: Line[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<Line | null>(null);
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [loadingCands, setLoadingCands] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  function openReview(line: Line) {
    setOpen(line);
    setNote("");
    setCandidates([]);
    setLoadingCands(true);
    getMatchCandidates(line.id).then((c) => {
      setCandidates(c);
      setLoadingCands(false);
    });
  }

  function act(fn: () => Promise<void>) {
    start(async () => {
      await fn();
      setOpen(null);
      router.refresh();
    });
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-3 py-1.5 whitespace-nowrap text-slate-600">{l.date}</td>
                <td className="px-3 py-1.5 text-slate-700">{l.description}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                  {usd(l.amount)}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <button
                    onClick={() => openReview(l)}
                    className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !pending && setOpen(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4">
              <div className="text-xs text-slate-400">Reviewing bank transaction</div>
              <div className="mt-1 flex items-baseline justify-between gap-4">
                <div className="text-sm text-slate-700">
                  <span className="font-medium">{open.date}</span> · {open.description}
                </div>
                <div className="text-lg font-semibold tabular-nums text-slate-800">
                  {usd(open.amount)}
                </div>
              </div>
            </div>

            <div className="mb-2 text-sm font-medium text-slate-700">Match to a ledger entry</div>
            <div className="mb-5 overflow-hidden rounded-lg border border-slate-200">
              {loadingCands ? (
                <p className="p-3 text-sm text-slate-500">Searching…</p>
              ) : candidates.length === 0 ? (
                <p className="p-3 text-sm text-slate-500">
                  No ledger entry with this amount. Use one of the options below.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {candidates.map((c) => (
                      <tr key={c.id}>
                        <td className="px-3 py-1.5 whitespace-nowrap text-slate-600">{c.date}</td>
                        <td className="px-3 py-1.5 text-slate-700">{c.account}</td>
                        <td className="px-3 py-1.5 text-slate-500">{c.vendor ?? c.split ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right">
                          <button
                            disabled={pending}
                            onClick={() => act(() => matchLine(open.id, c.id))}
                            className="rounded-md bg-[#1f3a5f] px-3 py-1 text-xs font-medium text-white hover:bg-[#16304f] disabled:opacity-50"
                          >
                            Match
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Note (optional)
              </label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. personal expense, duplicate, to be booked…"
                className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  onClick={() => setOpen(null)}
                  disabled={pending}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  disabled={pending}
                  onClick={() => act(() => reviewLine(open.id, "IGNORED", note))}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Ignore
                </button>
                <button
                  disabled={pending}
                  onClick={() => act(() => reviewLine(open.id, "FLAGGED", note))}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  Flag — missing booking
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
