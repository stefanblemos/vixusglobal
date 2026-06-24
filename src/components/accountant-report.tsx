"use client";

import { useState, useTransition } from "react";
import { generateAccountantReport } from "@/lib/actions/accountant-report";

export function AccountantReport({ companyId, year }: { companyId: string; year: number }) {
  const [text, setText] = useState("");
  const [qCount, setQCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function generate() {
    setError("");
    setCopied(false);
    start(async () => {
      try {
        const r = await generateAccountantReport(companyId, year);
        setText(r.emailText);
        setQCount(r.findings.questions.length);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not generate the report.");
      }
    });
  }

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function downloadPdf() {
    const res = await fetch(`/api/companies/${companyId}/accountant-report/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, text }),
    });
    if (!res.ok) {
      setError("Could not build the PDF.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    // libera depois de a aba carregar o blob
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const btn =
    "rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50";

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-slate-800">Report for the accountant</h3>
          <p className="text-xs text-slate-500">
            The app finds the divergences (our figures); AI drafts a ready-to-send email with the
            questions. Nothing is invented.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={pending}
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-50"
        >
          {pending ? "Generating…" : text ? "Regenerate" : "Generate report"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {text && (
        <>
          {qCount != null && (
            <p className="text-xs text-slate-500">
              {qCount === 0
                ? "No open questions — the return reconciles to the books."
                : `${qCount} question${qCount > 1 ? "s" : ""} to confirm.`}
            </p>
          )}
          <textarea
            readOnly
            value={text}
            rows={Math.min(22, text.split("\n").length + 2)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700"
          />
          <div className="flex gap-2">
            <button onClick={copy} className={btn}>
              {copied ? "Copied ✓" : "Copy email"}
            </button>
            <button onClick={downloadPdf} className={btn}>
              Abrir PDF
            </button>
          </div>
        </>
      )}
    </div>
  );
}
