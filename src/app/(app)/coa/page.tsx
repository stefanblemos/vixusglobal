import Link from "next/link";
import { ACCOUNT_SPECS, INTERCOMPANY_NOTE, M1_LABEL, type SpecAction } from "@/lib/coa/canonical";

export const dynamic = "force-dynamic";

const ACTION: Record<SpecAction, { label: string; cls: string }> = {
  criar: { label: "create", cls: "bg-emerald-100 text-emerald-700" },
  padronizar: { label: "standardize", cls: "bg-sky-100 text-sky-700" },
  separar: { label: "split", cls: "bg-amber-100 text-amber-700" },
};

export default function CoaPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Accounts to standardize in QBO</h1>
          <p className="max-w-3xl text-sm text-slate-500">
            You use the <strong>native QBO chart</strong> — and you can keep it. The app reads the{" "}
            <strong>section totals</strong> (Total Income/COGS/Expenses/Net Income; Assets/Liabilities/Equity),
            which already exist. Only these <strong>{ACCOUNT_SPECS.length} accounts</strong> need action, because the{" "}
            <strong>name or the split changes the tax calculation</strong>.
          </p>
        </div>
        <Link href="/coa/guides" className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm text-white hover:bg-[#16304f]">
          See posting guides →
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-600">
        <div className="font-medium text-slate-700">What the app does with your sub-accounts</div>
        <p className="mt-1">
          You can keep them all — the app sums the <strong>leaves</strong> (sub-accounts) and ignores the parent total (no double-counting),
          and the child <strong>inherits the parent&apos;s concept</strong> (a sub-account within “Meals” counts as meals
          even without “meal” in the name). Accounts numbered by company (banks, “0417 (Office)”) are real — don&apos;t unify them.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Standardized account</th>
              <th className="px-3 py-2 font-medium">Today</th>
              <th className="px-3 py-2 font-medium">Tax treatment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ACCOUNT_SPECS.map((a) => (
              <tr key={a.name} className="align-top">
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${ACTION[a.action].cls}`}>{ACTION[a.action].label}</span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-slate-800">{a.name}</div>
                  {a.note && <div className="text-[11px] text-slate-500">{a.note}</div>}
                  <div className="text-[10px] text-slate-400">QBO: {a.qboType} · {a.qboDetail}</div>
                </td>
                <td className="px-3 py-2.5 text-[11px] text-slate-500">{a.today}</td>
                <td className="px-3 py-2.5">
                  {a.m1 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">{M1_LABEL[a.m1]}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-sky-200 bg-sky-50/50 px-4 py-3 text-xs text-sky-900">
        <div className="font-medium">Intercompany — name the affiliate the same across all</div>
        <p className="mt-1">{INTERCOMPANY_NOTE.problem}</p>
        <p className="mt-1">{INTERCOMPANY_NOTE.rule}</p>
      </div>

      <p className="text-[11px] text-slate-400">
        <span className="rounded bg-emerald-100 px-1 text-emerald-700">create</span> = new account ·{" "}
        <span className="rounded bg-sky-100 px-1 text-sky-700">standardize</span> = unify the spellings into a single name ·{" "}
        <span className="rounded bg-amber-100 px-1 text-amber-700">split</span> = break up an account that mixes two
        treatments. Once that&apos;s done, the app reads and places each value in the right spot — no regex guessing.
      </p>
    </div>
  );
}
