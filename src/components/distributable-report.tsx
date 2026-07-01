"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { DistOwner, DistSource } from "@/lib/tax/distributable";

const m = (v: number) => formatMoney(v, "USD");
const mn = (v: number | null) => (v == null ? "—" : formatMoney(v, "USD"));

// Relatório de base distribuível com drill-down: clicar numa origem abre o ano-a-ano do capital
// account (do IR) — para CONFERIR como se chegou na base acumulada.
export function DistributableReport({ owners }: { owners: DistOwner[] }) {
  const [sel, setSel] = useState<DistSource | null>(null);

  return (
    <div className="space-y-4">
      {owners.map((o) => (
        <section key={o.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-800">{o.name}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${o.kind === "C-corp" ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700"}`}>
                {o.kind}
              </span>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-slate-400">distribuível sem imposto</div>
              <div className="text-lg font-semibold tabular-nums text-[#3B6D11]">{m(o.total)}</div>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="px-4 py-1.5 font-medium">De (pass-through)</th>
                <th className="px-3 py-1.5 text-right font-medium">Capital account (IR)</th>
                <th className="px-3 py-1.5 text-right font-medium">%</th>
                <th className="px-3 py-1.5 text-right font-medium">Distribuível</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {o.sources.map((s, i) => (
                <tr
                  key={i}
                  onClick={() => setSel(s)}
                  className="cursor-pointer hover:bg-sky-50/50"
                  title="Ver o ano-a-ano da capital account"
                >
                  <td className="px-4 py-1.5">
                    <span className="text-slate-800">{s.name}</span>
                    <span className="ml-1 text-[10px] text-slate-400">IR {s.irYear}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{m(s.capitalAccount)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{s.pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%</td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-800">{m(s.amount)}</td>
                  <td className="px-2 py-1.5 text-right text-slate-300">›</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {sel && <DetailModal src={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function DetailModal({ src, onClose }: { src: DistSource; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-base font-semibold text-slate-800">{src.name}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              Base = capital account (fim) do IR de {src.irYear} = <strong>{m(src.capitalAccount)}</strong> · sua fatia:{" "}
              {src.pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}% = <strong>{m(src.amount)}</strong>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="rounded-lg px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-1.5 font-medium">Ano (IR)</th>
                <th className="px-3 py-1.5 text-right font-medium">Início</th>
                <th className="px-3 py-1.5 text-right font-medium">+ Renda</th>
                <th className="px-3 py-1.5 text-right font-medium">+ Guaranteed</th>
                <th className="px-3 py-1.5 text-right font-medium">− Distribuições</th>
                <th className="px-3 py-1.5 text-right font-medium">= Fim (acum.)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {src.yearDetail.map((y) => (
                <tr key={y.year} className={y.year === src.irYear ? "bg-[#8DC63F]/[0.07]" : ""}>
                  <td className="px-3 py-1.5 font-medium text-slate-700">
                    {y.year}
                    {y.year === src.irYear && <span className="ml-1 text-[10px] text-[#3B6D11]">base</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{mn(y.capBegin)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{mn(y.income)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{mn(y.guaranteed)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-rose-600">{mn(y.distributions)}</td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-800">{mn(y.capEnd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] text-slate-400">
          A conta de capital acumula ano a ano: <strong>início + renda tributada + guaranteed − distribuições = fim</strong>.
          O <strong>fim</strong> do último IR é a base distribuível (renda já tributada e ainda não distribuída). Células
          &ldquo;—&rdquo; = figura não presente naquele IR. Confira contra a declaração.
        </p>
      </div>
    </div>
  );
}
