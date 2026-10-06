"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// Botão "＋ Lançar" do pool (etapa 3): um menu com os fatos possíveis; cada um leva ao fluxo
// que já existe (nada se digita em dois lugares). Casas abertas aparecem como sub-itens.

export function PoolLaunchMenu({
  poolId,
  openHouses,
}: {
  poolId: string;
  openHouses: Array<{ id: string; address: string }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const item = (href: string, icon: string, title: string, sub: string) => (
    <Link key={href + title} href={href} onClick={() => setOpen(false)} className="flex gap-3 border-b border-slate-50 px-3.5 py-2.5 text-[13px] text-slate-700 hover:bg-slate-50">
      <span className="w-6 text-center text-base">{icon}</span>
      <span><b className="block">{title}</b><span className="text-[11px] text-slate-400">{sub}</span></span>
    </Link>
  );
  const houseSubs = (icon: string, title: string, sub: string, hrefOf: (id: string) => string) =>
    openHouses.length === 0
      ? item(`/pools/${poolId}?tab=houses`, icon, title, "nenhuma casa aberta — ver Casas")
      : openHouses.length === 1
        ? item(hrefOf(openHouses[0].id), icon, title, `${openHouses[0].address} · ${sub}`)
        : (
          <div key={title} className="border-b border-slate-50">
            <div className="flex gap-3 px-3.5 pt-2.5 text-[13px] text-slate-700"><span className="w-6 text-center text-base">{icon}</span><span><b className="block">{title}</b><span className="text-[11px] text-slate-400">{sub}</span></span></div>
            <div className="flex flex-wrap gap-1 px-3.5 pb-2.5 pl-12">
              {openHouses.map((h) => (
                <Link key={h.id} href={hrefOf(h.id)} onClick={() => setOpen(false)} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-blue-50 hover:text-[#1f3a5f]">
                  {h.address.split(" ").slice(0, 2).join(" ")}
                </Link>
              ))}
            </div>
          </div>
        );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg bg-[#1f3a5f] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#16304f]"
      >
        ＋ Lançar ▾
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-[330px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          {item(`/pools/${poolId}?tab=investors&open=call`, "📣", "Recebi aporte (chamada de capital)", "rateio pelo % atual · parcial / não participa / cobriu")}
          {houseSubs("🏠", "Vendi uma casa", "etapa 7 da casa: contrato → closing", (id) => `/pools/${poolId}/houses/${id}#venda`)}
          {houseSubs("🧱", "Paguei lote / obra / taxa de uma casa", "extrato da casa (+ Lançar)", (id) => `/pools/${poolId}/houses/${id}#extrato`)}
          {item(`/pools/${poolId}/loan?stab=draws`, "🏦", "Recebi draw do banco", "Financiamento › Draws (liberação)")}
          {item(`/pools/${poolId}?tab=investors&sub=ledger`, "🧾", "Despesa ou receita do pool", "LLC, contabilidade, IR/K-1 · crédito do lender, reembolso")}
          {item(`/pools/${poolId}?tab=investors&sub=distributions`, "💸", "Distribuí aos sócios", "prévia do rateio pro rata antes de confirmar")}
          {houseSubs("↩", "Devolvi excedente de uma casa ao caixa", "banco pagou mais que a obra", (id) => `/pools/${poolId}/houses/${id}#extrato`)}
        </div>
      )}
    </div>
  );
}
