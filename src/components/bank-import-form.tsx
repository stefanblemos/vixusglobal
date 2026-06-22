"use client";

import { useState, useTransition } from "react";
import {
  analyzeBankStatement,
  saveBankStatement,
  type AnalyzeBankResult,
} from "@/lib/actions/bank";
import { gzipB64 } from "@/lib/util/gzip-client";

const usd = (v: string | null) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(v));

export function BankImportForm({ banks }: { banks: { id: string; label: string }[] }) {
  const [bankId, setBankId] = useState(banks[0]?.id ?? "");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<AnalyzeBankResult | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setError("");
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result));
    reader.readAsText(file);
  }

  function analyze() {
    setError("");
    if (!text.trim()) {
      setError("Choose a CSV file first (or wait for it to finish loading).");
      return;
    }
    start(async () => {
      try {
        const r = await analyzeBankStatement(await gzipB64(text), bankId);
        if (r.statement.lines.length === 0) {
          const label = banks.find((b) => b.id === bankId)?.label ?? "this bank";
          setError(
            `No transactions were recognized with the ${label} format. Check the bank you picked and that this is the bank's CSV export.`,
          );
          return;
        }
        setResult(r);
      } catch (err) {
        // Mostra o erro real (parse, permissão, rede) em vez de uma mensagem genérica enganosa.
        setError(
          err instanceof Error && err.message
            ? `Import failed: ${err.message}`
            : "Import failed — please try again.",
        );
      }
    });
  }

  function save() {
    start(async () => {
      const gz = await gzipB64(text);
      await saveBankStatement({ gz, bankId, companyId, fileName });
    });
  }

  const inputClass = "rounded-lg border border-slate-300 px-3 py-2 text-sm";

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Bank (format)</label>
            <select
              value={bankId}
              onChange={(e) => setBankId(e.target.value)}
              className={inputClass}
            >
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-600">Statement CSV</label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="block text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
          </div>
          <button
            onClick={analyze}
            disabled={!text || pending}
            className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-50"
          >
            {pending ? "Analyzing…" : "Analyze"}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {result && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <Meta
              label="Period"
              value={`${result.statement.periodStart ?? "?"} → ${result.statement.periodEnd ?? "?"}`}
            />
            <Meta label="Beginning" value={usd(result.statement.beginningBalance)} />
            <Meta label="Ending" value={usd(result.statement.endingBalance)} />
            <Meta label="Transactions" value={String(result.statement.lines.length)} />
          </div>

          <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
            <div className="min-w-64 flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Company / bank account
              </label>
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className={`${inputClass} w-full`}
              >
                <option value="">— Select —</option>
                {result.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.legalName}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={save}
              disabled={pending || !companyId}
              className="rounded-lg bg-[#8DC63F] px-4 py-2 text-sm font-medium text-[#173404] hover:bg-[#7eb536] disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save & reconcile"}
            </button>
          </div>

          <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.statement.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 whitespace-nowrap text-slate-600">{l.date}</td>
                    <td className="px-3 py-1.5 text-slate-700">{l.description}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                      {usd(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-slate-800">{value}</div>
    </div>
  );
}
