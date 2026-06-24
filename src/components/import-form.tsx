"use client";

import { useState, useTransition, useEffect } from "react";
import * as XLSX from "xlsx";
import { analyzeQbo, saveQboImport, type AnalyzeResult } from "@/lib/actions/qbo";
import { analyzeGl, glPreFormation, saveGl, type GlAnalyzeResult, type GlPreFormation } from "@/lib/actions/gl";
import { gzipB64 } from "@/lib/util/gzip-client";

// O GL é transacional (parser e tela diferentes do BS/P&L). Detecta pelo título
// ("General Ledger" / "Livro razão" PT) ou pela assinatura de colunas do GL — o
// QBO exporta no idioma da empresa, então o título sozinho não basta. Usa prefixos
// SEM acento ("livro raz", "conta de distribui", "data de transa") para não depender
// do encoding com que o navegador leu o arquivo (ã/ç poderiam vir mal codificados).
function looksLikeGeneralLedger(csv: string): boolean {
  const head = csv.split(/\r?\n/).slice(0, 8).join("\n").toLowerCase();
  return (
    head.includes("general ledger") ||
    head.includes("livro raz") ||
    // assinatura de colunas (linha de cabeçalho do GL): conta de distribuição + data
    (head.includes("conta de distribui") && head.includes("data de transa")) ||
    (head.includes("distribution account") && head.includes("transaction date"))
  );
}

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
  const [glResult, setGlResult] = useState<GlAnalyzeResult | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [glWarn, setGlWarn] = useState<GlPreFormation | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  // Checagem (no import): lançamentos do GL anteriores à abertura da empresa selecionada.
  // Re-roda quando troca a empresa no preview. Não bloqueia o save, só alerta.
  useEffect(() => {
    if (!glResult || !companyId) {
      setGlWarn(null);
      return;
    }
    let ignore = false;
    (async () => {
      try {
        const gz = await gzipB64(text);
        const w = await glPreFormation(gz, companyId);
        if (!ignore) setGlWarn(w);
      } catch {
        if (!ignore) setGlWarn(null);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [glResult, companyId, text]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setGlResult(null);
    setError("");
    const reader = new FileReader();
    if (/\.xlsx?$/i.test(file.name)) {
      // Excel: lê a 1ª planilha e converte para CSV (mesmo formato do export CSV do QBO).
      reader.onload = () => {
        try {
          const wb = XLSX.read(reader.result as ArrayBuffer, { type: "array" });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          setText(XLSX.utils.sheet_to_csv(sheet));
        } catch {
          setError("Could not read this Excel file.");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => setText(String(reader.result));
      reader.readAsText(file);
    }
  }

  function analyze() {
    setError("");
    setResult(null);
    setGlResult(null);
    if (!text.trim()) {
      setError("Choose a CSV/Excel file first (or wait for it to finish loading).");
      return;
    }
    start(async () => {
      try {
        const gz = await gzipB64(text); // comprime (GL grande estoura o limite de corpo da Vercel)
        if (looksLikeGeneralLedger(text)) {
          const r = await analyzeGl(gz);
          setGlResult(r);
          setCompanyId(r.matchedCompanyId ?? "");
        } else {
          const r = await analyzeQbo(gz);
          if (r.report.lines.length === 0) {
            setError("No report lines were recognized. Is this a QBO Balance Sheet / P&L / GL export?");
            return;
          }
          setResult(r);
          setCompanyId(r.matchedCompanyId ?? "");
        }
      } catch (err) {
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
      await saveQboImport({ gz, companyId: companyId || null, fileName });
    });
  }

  function saveGeneralLedger() {
    setError("");
    start(async () => {
      try {
        const gz = await gzipB64(text);
        await saveGl({ gz, companyId: companyId || null, fileName });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save the General Ledger.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <label className="mb-2 block text-sm font-medium text-slate-700">QBO CSV file</label>
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
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

      {glResult && (
        <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <Meta label="Source name" value={glResult.companyName} />
            <Meta label="Report" value="General Ledger" />
            <Meta label="Period" value={glResult.periodLabel || "—"} />
            <Meta
              label="Transactions"
              value={`${glResult.transactions.toLocaleString("en-US")} · ${glResult.accounts.length} accounts`}
            />
          </div>

          <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
            <div className="min-w-64 flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Link to company <span className="text-rose-500">*</span>
              </label>
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— Select a company —</option>
                {glResult.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.legalName}
                  </option>
                ))}
              </select>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs ${
                glResult.matchedCompanyId
                  ? "bg-green-50 text-green-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {glResult.matchedCompanyId ? "Auto-matched by name/alias" : "No automatic match"}
            </span>
            <button
              onClick={saveGeneralLedger}
              disabled={pending || !companyId}
              className="rounded-lg bg-[#8DC63F] px-4 py-2 text-sm font-medium text-[#173404] hover:bg-[#7eb536] disabled:opacity-50"
            >
              {pending ? "Importing…" : "Import General Ledger"}
            </button>
          </div>

          {glWarn?.hasFormation && glWarn.count > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="font-medium">
                ⚠ {glWarn.count} lançamento{glWarn.count > 1 ? "s" : ""} com data ANTERIOR à abertura
                {glWarn.formationDate ? ` (${glWarn.formationDate})` : ""}.
              </div>
              <p className="mt-1 text-amber-800">
                Confira: ou o GL é de outra empresa/período, ou a data de abertura cadastrada está
                errada (a empresa pode ter aberto antes).
              </p>
              <ul className="mt-2 space-y-0.5 text-xs text-amber-800">
                {glWarn.examples.map((e, i) => (
                  <li key={i} className="tabular-nums">
                    {e.date} · {e.account} ·{" "}
                    {e.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </li>
                ))}
                {glWarn.count > glWarn.examples.length && (
                  <li className="text-amber-700">+ {glWarn.count - glWarn.examples.length} outro(s)…</li>
                )}
              </ul>
              <p className="mt-1.5 text-xs text-amber-700">
                Não bloqueia a importação — é só um alerta para você revisar.
              </p>
            </div>
          )}

          {glWarn && !glWarn.hasFormation && glWarn.earliestDate && (
            <p className="rounded-lg bg-slate-50 px-4 py-2 text-xs text-slate-500">
              Abertura não cadastrada nesta empresa — não dá para checar lançamentos pré-abertura. O
              GL começa em {glWarn.earliestDate}. Cadastre a data de abertura para ativar o alerta.
            </p>
          )}

          {glResult.sameYearPeriod && (
            <p className="rounded-lg bg-sky-50 px-4 py-2 text-sm text-sky-800">
              Já existe um GL de {glResult.sameYearPeriod}. As linhas novas serão{" "}
              <strong>somadas</strong> e as duplicadas (mesma data, valor, conta e memo){" "}
              <strong>ignoradas</strong> — nada é apagado, e a reconciliação é preservada. GLs de
              outros anos não são afetados.
            </p>
          )}

          {glResult.accounts.length > 0 && (
            <div className="border-t border-slate-100 pt-4">
              <div className="mb-2 text-xs font-medium text-slate-500">Accounts detected</div>
              <div className="flex flex-wrap gap-1.5">
                {glResult.accounts.map((a) => (
                  <span
                    key={a}
                    className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600"
                  >
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}
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
