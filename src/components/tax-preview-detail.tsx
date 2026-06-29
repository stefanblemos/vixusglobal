"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { TaxPreviewRow, EntityType } from "@/lib/tax/preview";

const TYPE_TAG: Record<EntityType, string> = {
  "C-corp": "bg-sky-50 text-sky-700",
  "Pass-through": "bg-green-50 text-green-700",
  PF: "bg-amber-50 text-amber-700",
};
const m = (n: number) => formatMoney(n, "USD");

// Tabela do tax preview com drill-down: clicar numa entidade abre o "report" do cálculo passo a
// passo (lucro book → ajustes → base → imposto) e o fluxo K-1 (de quais investidas vem, para quais
// owners vai). Origem e destino do K-1 permitem rastrear das formadoras até os donos.
export function TaxPreviewTable({ rows, year }: { rows: TaxPreviewRow[]; year: number }) {
  const [selKey, setSelKey] = useState<string | null>(null);
  const sel = selKey ? (rows.find((r) => r.key === selKey) ?? null) : null;

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Entidade</th>
              <th className="px-3 py-2 text-right font-medium">Lucro líq.</th>
              <th className="px-3 py-2 text-right font-medium">+ Não ded.</th>
              <th className="px-3 py-2 text-right font-medium">± Deprec.</th>
              <th className="px-3 py-2 text-right font-medium">+ K-1</th>
              <th className="px-3 py-2 text-right font-medium">= Base trib.</th>
              <th className="px-3 py-2 text-right font-medium">IR estimado</th>
              <th className="px-3 py-2 font-medium">Fluxo</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-4 text-sm text-slate-400">
                  Nenhuma entidade no escopo. Verifique empresas/pessoas marcadas no fechamento.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.key}
                  onClick={() => setSelKey(r.key)}
                  className={`cursor-pointer hover:bg-sky-50/50 ${r.taxable < 0 ? "bg-red-50/30" : ""}`}
                  title="Ver o cálculo passo a passo"
                >
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-800">{r.name}</div>
                    <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${TYPE_TAG[r.entityType]}`}>{r.entityType}</span>
                    {!r.hasPnl && r.kind === "company" && <span className="ml-1 text-[10px] text-amber-600">sem P&L</span>}
                    {r.inCycle && (
                      <span className="ml-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700" title="Posse circular — K-1 cruzado aproximado.">
                        ⚠ ciclo
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.kind === "person" ? "—" : m(r.bookNet)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {r.nonDeductible + r.stateTaxAddBack ? m(r.nonDeductible + r.stateTaxAddBack) : "—"}
                    {r.stateTaxAddBack > 0 && (
                      <div className="text-[10px] text-sky-700">inclui estadual {m(r.stateTaxAddBack)}</div>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.depAdj < 0 ? "text-emerald-600" : "text-slate-600"}`}>
                    {r.macrsApplied ? m(r.depAdj) : "—"}
                    {r.kind === "company" && r.hasPnl && r.macrsApplied && (
                      <div className="text-[10px] text-emerald-700">deprec. aplicada</div>
                    )}
                    {r.kind === "company" && r.hasPnl && !r.macrsApplied && r.depCatchUp != null && Math.abs(r.depCatchUp) > 1 && (
                      <div className="text-[10px] text-amber-600">catch-up {m(r.depCatchUp)}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.k1In ? m(r.k1In) : "—"}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${r.taxable < 0 ? "text-red-600" : "text-slate-800"}`}>{m(r.taxable)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.entityType === "Pass-through" ? (
                      <span className="text-slate-400">— (repassa)</span>
                    ) : (
                      <span className="font-semibold text-slate-900">{m(r.tax)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {r.entityType === "Pass-through"
                      ? r.passesTo.length
                        ? `repassa: ${r.passesTo.map((p) => `${p.acronym} ${p.pct.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`).join(" · ")}`
                        : "repassa aos sócios"
                      : r.entityType === "PF"
                        ? "pagador final (1040)"
                        : "paga 21%"}
                  </td>
                  <td className="px-2 py-2 text-right text-slate-300">›</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {sel && <DetailModal row={sel} year={year} onClose={() => setSelKey(null)} onSelect={setSelKey} />}
    </>
  );
}

// Linha da cascata da base.
function Step({ label, value, hint, muted }: { label: string; value: number; hint?: string; muted?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="text-sm text-slate-600">
        {label}
        {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
      </div>
      <div className={`shrink-0 tabular-nums ${muted ? "text-slate-400" : value < 0 ? "text-rose-700" : "text-slate-800"}`}>
        {value < 0 ? `(${m(Math.abs(value))})` : m(value)}
      </div>
    </div>
  );
}

function DetailModal({
  row,
  year,
  onClose,
  onSelect,
}: {
  row: TaxPreviewRow;
  year: number;
  onClose: () => void;
  onSelect: (key: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isPerson = row.kind === "person";
  const isPass = row.entityType === "Pass-through";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-base font-semibold text-slate-800">{row.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${TYPE_TAG[row.entityType]}`}>{row.entityType}</span>
              {!row.hasPnl && !isPerson && <span className="text-[10px] text-amber-600">sem P&L do ano (base $0 + K-1)</span>}
              {row.inCycle && <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700">⚠ ciclo</span>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="rounded-lg px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
        </div>

        {row.kind === "company" && (
          <div className="mt-2 flex items-center gap-3 text-xs">
            <span className="text-slate-400">Conferir no QBO:</span>
            {row.pnlImportId ? (
              <Link href={`/import/${row.pnlImportId}`} className="text-sky-700 hover:underline">P&amp;L do ano →</Link>
            ) : (
              <span className="text-amber-600">P&amp;L não importado</span>
            )}
            {row.bsImportId ? (
              <Link href={`/import/${row.bsImportId}`} className="text-sky-700 hover:underline">Balance Sheet →</Link>
            ) : (
              <span className="text-amber-600">BS não importado</span>
            )}
          </div>
        )}

        {/* Cascata da base */}
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Base tributável ({year})</div>
          <div className="divide-y divide-slate-100">
            <Step label={isPerson ? "Renda própria" : "Lucro líquido (book · P&L)"} value={row.bookNet} muted={isPerson && row.bookNet === 0} />
            {row.nonDeductible !== 0 && (
              <>
                <Step label="+ Não dedutíveis (Schedule M-1)" value={row.nonDeductible} hint="o livro lançou como despesa, mas não abate imposto → voltam à base (IR federal é o maior caso)" />
                {row.nonDeductibleItems.length > 0 && (
                  <div className="py-1 pl-3">
                    {row.nonDeductibleItems.map((it, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span className="truncate">{it.label}</span>
                        <span className="shrink-0 tabular-nums">{m(it.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {row.stateTaxAddBack !== 0 && (
              <Step
                label="+ Imposto estadual — add-back"
                value={row.stateTaxAddBack}
                hint={`${row.stateTaxSource === "florida" ? `principal + multa pagos em ${year} (controle Florida)` : `imposto estadual lançado como despesa no P&L de ${year}`}${row.stateTaxInterest > 0 ? ` · juros ${m(row.stateTaxInterest)} são dedutíveis (ficam de fora)` : ""}`}
              />
            )}
            {row.depAdj !== 0 ? (
              <Step label="± Ajuste de depreciação" value={row.depAdj} hint="o P&L não tinha depreciação no ano → aplica a depreciação REAL dos ativos (registrada na conferência; MACRS só se não houver real)" />
            ) : (
              !isPerson && row.hasPnl && (
                <div className="py-1.5 text-[11px] text-slate-400">
                  Depreciação: confia no livro (ajuste $0).
                  {row.bookDep > 0 && <> Livro {m(row.bookDep)} · MACRS {m(row.macrsDep)}.</>}
                  {row.depCatchUp != null && Math.abs(row.depCatchUp) > 1 && (
                    <>
                      {" "}Catch-up de {m(row.depCatchUp)} é só flag (não entra no imposto) —{" "}
                      <Link href={`/assets?tab=conferencia&company=${row.id}`} className="underline hover:text-amber-700">ver Conferência</Link>.
                    </>
                  )}
                </div>
              )
            )}
            {row.k1In !== 0 && <Step label="+ K-1 recebido (investidas)" value={row.k1In} />}
            {/* origem do K-1 */}
            {row.k1From.length > 0 && (
              <div className="py-1.5 pl-3">
                <div className="text-[11px] text-slate-400">vem de:</div>
                {row.k1From.map((f) => (
                  <button
                    key={f.fromKey}
                    onClick={() => onSelect(f.fromKey)}
                    className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-xs hover:bg-sky-50"
                    title="Abrir o cálculo desta investida"
                  >
                    <span className="text-sky-700 hover:underline">{f.fromName}</span>
                    <span className={`tabular-nums ${f.amount < 0 ? "text-rose-700" : "text-slate-600"}`}>
                      {f.amount < 0 ? `(${m(Math.abs(f.amount))})` : m(f.amount)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-1 flex items-center justify-between border-t-2 border-slate-200 pt-2">
            <span className="text-sm font-medium text-slate-700">= Base tributável</span>
            <span className={`text-base font-semibold tabular-nums ${row.taxable < 0 ? "text-rose-700" : "text-slate-900"}`}>
              {row.taxable < 0 ? `(${m(Math.abs(row.taxable))})` : m(row.taxable)}
            </span>
          </div>
        </div>

        {/* Imposto */}
        <div className="mt-3 flex items-center justify-between rounded-lg border-2 border-[#8DC63F]/50 bg-[#8DC63F]/[0.08] px-3 py-2.5">
          <div className="text-sm text-slate-700">
            {isPass ? (
              "Pass-through — não paga no nível; repassa a base via K-1"
            ) : row.entityType === "C-corp" ? (
              <>C-corp — 21% × base{row.taxable < 0 ? " (prejuízo → $0; sem carry-forward de NOL aqui)" : ""}</>
            ) : (
              "PF — faixas federais MFJ 2024, dedução padrão (só federal, sem créditos)"
            )}
          </div>
          <div className="text-lg font-semibold tabular-nums text-[#3B6D11]">{isPass ? "—" : m(row.tax)}</div>
        </div>

        {/* Fluxo para os owners (pass-through) */}
        {isPass && (
          <div className="mt-3">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Repassa a base para</div>
            {row.passesTo.length === 0 ? (
              <p className="text-xs text-slate-400">Sócios não cadastrados — cadastre a ownership para ver o fluxo.</p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {row.passesTo.map((p) => (
                  <div key={p.acronym + p.pct} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                    <span className="text-slate-700">{p.name}</span>
                    <span className="flex items-center gap-3 tabular-nums">
                      <span className="text-xs text-slate-400">{p.pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%</span>
                      <span className={row.taxable < 0 ? "text-rose-700" : "text-slate-800"}>
                        {(() => { const a = Math.round((row.taxable * p.pct) / 100 * 100) / 100; return a < 0 ? `(${m(Math.abs(a))})` : m(a); })()}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="mt-3 text-[11px] text-slate-400">
          Estimativa de controle. Confie no livro para a depreciação (a divergência vs MACRS é flag, não
          imposto); prejuízo de C-corp não carrega NOL aqui; faixas PF são MFJ 2024. Confirme com o contador.
        </p>
      </div>
    </div>
  );
}
