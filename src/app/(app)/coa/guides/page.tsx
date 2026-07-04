import Link from "next/link";
import { POSTING_GUIDES } from "@/lib/coa/guides";

export const dynamic = "force-dynamic";

export default function PostingGuidesPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/coa" className="text-xs text-sky-700 hover:underline">← Chart of accounts</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">Posting guides</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          How to post each transaction in QBO using the canonical chart — so the app reads it right and the tax
          calculation comes out exact, without interpretation by the accountant or the system. Each guide shows the{" "}
          <span className="rounded bg-emerald-50 px-1 text-emerald-700">debit</span> /{" "}
          <span className="rounded bg-sky-50 px-1 text-sky-700">credit</span> and the common mistake it avoids.
        </p>
      </div>

      <div className="space-y-4">
        {POSTING_GUIDES.map((g) => (
          <section key={g.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
              <div className="font-medium text-slate-800">{g.title}</div>
              <div className="text-xs text-slate-500">{g.when}</div>
            </div>
            <div className="px-4 py-3">
              <table className="w-full text-sm">
                <tbody>
                  {g.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="w-8 py-1">
                        <span className={`inline-flex h-5 w-5 items-center justify-center rounded text-xs font-semibold ${l.side === "D" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}`}>
                          {l.side}
                        </span>
                      </td>
                      <td className="py-1 font-medium text-slate-800">{l.account}</td>
                      <td className="py-1 pl-3 text-[11px] text-slate-500">{l.hint}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {g.wrong && (
                <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
                  <span className="font-medium">✗ Common mistake:</span> {g.wrong}
                </div>
              )}
              {g.note && <p className="mt-2 text-[11px] text-slate-500">{g.note}</p>}
            </div>
          </section>
        ))}
      </div>

      <p className="text-[11px] text-slate-400">
        Accounting convention: <strong>D</strong> (debit) increases assets/expenses; <strong>C</strong> (credit)
        increases liabilities/equity/revenue. When in doubt, confirm with your accountant — these guides exist to
        align everyone on the same standard.
      </p>
    </div>
  );
}
