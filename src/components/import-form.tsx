"use client";

import { useState, useTransition } from "react";
import { analyzeQbo, saveQboImport, type AnalyzeResult } from "@/lib/actions/qbo";

const fmtUSD = (v: string | null) =>
  v == null
    ? ""
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(v));

const REPORT_LABEL: Record<string, string> = {
  BALANCE_SHEET: "Balance Sheet",
  PROFIT_AND_LOSS: "Profit & Loss",
  UNKNOWN: "Unknown",
};

export function ImportForm() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
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
    start(async () => {
      try {
        const r = await analyzeQbo(text);
        setResult(r);
        setCompanyId(r.matchedCompanyId ?? "");
      } catch {
        setError("Could not parse this file. Is it a QBO CSV report?");
      }
    });
  }

  function save() {
    start(async () => {
      await saveQboImport({ text, companyId: companyId || null, fileName });
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <label className="mb-2 block text-sm font-medium text-slate-700">QBO CSV file</label>
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="block text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
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
        <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <Meta label="Source name" value={result.report.companyName} />
            <Meta label="Report" value={REPORT_LABEL[result.report.reportType]} />
            <Meta label="Period" value={result.report.periodLabel} />
            <Meta label="Basis" value={result.report.basis ?? "—"} />
          </div>

          <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
            <div className="min-w-64 flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Link to company
              </label>
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— Not linked —</option>
                {result.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.legalName}
                  </option>
                ))}
              </select>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs ${
                result.matchedCompanyId
                  ? "bg-green-50 text-green-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {result.matchedCompanyId ? "Auto-matched by name/alias" : "No automatic match"}
            </span>
            <button
              onClick={save}
              disabled={pending}
              className="rounded-lg bg-[#8DC63F] px-4 py-2 text-sm font-medium text-[#173404] hover:bg-[#7eb536] disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save import"}
            </button>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Account</th>
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 text-right font-medium">{result.report.columns[0]}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.report.lines.map((l, i) => (
                  <tr key={i} className={l.lineType === "TOTAL" ? "bg-slate-50/50" : ""}>
                    <td
                      className={`px-4 py-1.5 ${
                        l.lineType === "SECTION"
                          ? "font-medium text-slate-800"
                          : l.lineType === "TOTAL"
                            ? "font-medium text-slate-600"
                            : "text-slate-700"
                      }`}
                      style={{ paddingLeft: 16 + l.depth * 16 }}
                    >
                      {l.label}
                    </td>
                    <td className="px-4 py-1.5 text-xs text-slate-400">{l.accountCode ?? ""}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-700">
                      {fmtUSD(l.values[0])}
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
