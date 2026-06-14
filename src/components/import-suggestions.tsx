"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createLoanFromImport,
  createOwnershipFromImport,
  createCompanyForCounterparty,
  type ActionResult,
} from "@/lib/actions/relationships";
import { SUGGESTION_LABEL, type SuggestionKind } from "@/lib/qbo/detect";

export interface ResolvedSuggestion {
  kind: SuggestionKind;
  counterpartyName: string;
  amount: string | null;
  matchType: "company" | "party" | null;
  matchId: string | null;
  matchName: string | null;
}

const fmtUSD = (v: string | null) =>
  v == null
    ? ""
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(v));

export function ImportSuggestions({
  importId,
  importCompanyId,
  suggestions,
}: {
  importId: string;
  importCompanyId: string | null;
  suggestions: ResolvedSuggestion[];
}) {
  if (suggestions.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium text-slate-800">Detected relationships</h2>
      {!importCompanyId && (
        <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-700">
          Link this import to a company (above) to create loans and ownership.
        </p>
      )}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Counterparty</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {suggestions.map((s, i) => (
              <Row key={i} importId={importId} importCompanyId={importCompanyId} s={s} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({
  importId,
  importCompanyId,
  s,
}: {
  importId: string;
  importCompanyId: string | null;
  s: ResolvedSuggestion;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [pct, setPct] = useState("");

  const run = (fn: () => Promise<ActionResult>) => {
    setError("");
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Failed.");
      else router.refresh();
    });
  };

  return (
    <tr>
      <td className="px-4 py-3">
        <div className="font-medium text-slate-800">{s.counterpartyName}</div>
        {s.matchType === "company" ? (
          <span className="text-xs text-green-700">Matched: {s.matchName}</span>
        ) : s.matchType === "party" ? (
          <span className="text-xs text-slate-500">Individual: {s.matchName}</span>
        ) : (
          <span className="text-xs text-amber-600">No match</span>
        )}
      </td>
      <td className="px-4 py-3 text-slate-600">{SUGGESTION_LABEL[s.kind]}</td>
      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{fmtUSD(s.amount)}</td>
      <td className="px-4 py-3">
        {!importCompanyId ? (
          <span className="text-xs text-slate-400">—</span>
        ) : s.matchType === null ? (
          <button
            disabled={pending}
            onClick={() =>
              run(() => createCompanyForCounterparty({ importId, name: s.counterpartyName }))
            }
            className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            {pending ? "…" : "Create company"}
          </button>
        ) : s.kind === "OWNERSHIP" ? (
          s.matchType === "company" ? (
            <div className="flex items-center gap-2">
              <input
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                type="number"
                step="0.0001"
                min="0"
                max="100"
                placeholder="%"
                className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs"
              />
              <button
                disabled={pending}
                onClick={() =>
                  run(() =>
                    createOwnershipFromImport({
                      importId,
                      ownerCompanyId: importCompanyId,
                      ownedCompanyId: s.matchId!,
                      percentage: Number(pct),
                    }),
                  )
                }
                className="rounded-md bg-[#1f3a5f] px-3 py-1 text-xs font-medium text-white hover:bg-[#16304f] disabled:opacity-50"
              >
                {pending ? "…" : "Link ownership"}
              </button>
            </div>
          ) : (
            <span className="text-xs text-slate-400">Counterparty must be a company</span>
          )
        ) : s.matchType === "company" ? (
          <button
            disabled={pending}
            onClick={() =>
              run(() =>
                createLoanFromImport({
                  importId,
                  importCompanyId,
                  counterpartyCompanyId: s.matchId!,
                  kind: s.kind as "LOAN_RECEIVABLE" | "LOAN_PAYABLE",
                  amount: s.amount,
                }),
              )
            }
            className="rounded-md bg-[#1f3a5f] px-3 py-1 text-xs font-medium text-white hover:bg-[#16304f] disabled:opacity-50"
          >
            {pending ? "…" : "Create loan"}
          </button>
        ) : (
          <span className="text-xs text-slate-400">Individual lender — use Loans module</span>
        )}
        {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
      </td>
    </tr>
  );
}
