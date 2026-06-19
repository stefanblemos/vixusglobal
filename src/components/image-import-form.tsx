"use client";

import { useState, useTransition } from "react";
import { analyzeReportImage, saveReportImage, type AnalyzeImageResult } from "@/lib/actions/qbo-image";

const fmt = (v: number | null) =>
  v == null ? "" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);

// Reduz a imagem para caber no limite do server action (mantém legível p/ a extração).
async function fileToBase64(file: File): Promise<{ data: string; mediaType: string }> {
  if (file.type === "application/pdf") {
    const buf = await file.arrayBuffer();
    let bin = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return { data: btoa(bin), mediaType: "application/pdf" };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const max = 2000;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { data: dataUrl.split(",")[1], mediaType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ImageImportForm() {
  const [fileName, setFileName] = useState("");
  const [payload, setPayload] = useState<{ data: string; mediaType: string } | null>(null);
  const [result, setResult] = useState<AnalyzeImageResult | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [kind, setKind] = useState<"PROFIT_AND_LOSS" | "BALANCE_SHEET">("PROFIT_AND_LOSS");
  const [period, setPeriod] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setError("");
    try {
      setPayload(await fileToBase64(file));
    } catch {
      setError("Could not read this file.");
    }
  }

  function analyze() {
    if (!payload) return;
    setError("");
    start(async () => {
      try {
        const r = await analyzeReportImage(payload.data, payload.mediaType);
        setResult(r);
        setCompanyId(r.matchedCompanyId ?? "");
        setKind(r.report.reportType === "BALANCE_SHEET" ? "BALANCE_SHEET" : "PROFIT_AND_LOSS");
        setPeriod(r.report.periodLabel);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not extract this statement.");
      }
    });
  }

  function save() {
    if (!result) return;
    start(async () => {
      try {
        await saveReportImage({ report: result.report, companyId: companyId || null, reportKind: kind, periodLabel: period, fileName });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save.");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <label className="mb-1 block text-sm font-medium text-slate-700">
          P&amp;L / Balance Sheet image or PDF
        </label>
        <p className="mb-2 text-xs text-slate-500">
          For closed companies whose QBO no longer exports — extract a photo/scan with AI.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept="image/png,image/jpeg,application/pdf"
            onChange={onFile}
            className="block text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
          <button
            onClick={analyze}
            disabled={!payload || pending}
            className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-50"
          >
            {pending && !result ? "Extracting…" : "Extract with AI"}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {result && (
        <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <Meta label="Source name" value={result.report.companyName} />
            <div>
              <div className="text-xs text-slate-400">Report</div>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="PROFIT_AND_LOSS">Profit &amp; Loss</option>
                <option value="BALANCE_SHEET">Balance Sheet</option>
              </select>
            </div>
            <div>
              <div className="text-xs text-slate-400">Period</div>
              <input
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
            <Meta
              label="Confidence"
              value={`${result.report.confidence}${result.report.basis ? ` · ${result.report.basis}` : ""}`}
            />
          </div>

          {result.report.confidence === "low" && (
            <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-700">
              Low confidence — double-check the numbers below before saving.
            </p>
          )}

          <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
            <div className="min-w-64 flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-600">Link to company</label>
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
                result.matchedCompanyId ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
              }`}
            >
              {result.matchedCompanyId ? "Auto-matched" : "No automatic match"}
            </span>
            <button
              onClick={save}
              disabled={pending}
              className="rounded-lg bg-[#8DC63F] px-4 py-2 text-sm font-medium text-[#173404] hover:bg-[#7eb536] disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save import"}
            </button>
          </div>

          {result.duplicateId && (
            <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-700">
              An import for this company and period already exists — saving will replace it.
            </p>
          )}

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Account</th>
                  <th className="px-4 py-2 text-right font-medium">Value</th>
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
                      style={{ paddingLeft: l.section ? 28 : 16 }}
                    >
                      {l.label}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-700">
                      {fmt(l.value)}
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
