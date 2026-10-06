"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { addDistribution, deleteDistribution, type FormState } from "@/lib/actions/pools";
import { markLinePaid, unmarkLinePaid, type PayoutFormState } from "@/lib/actions/payout";
import type { Distributable, PerformanceSummary } from "@/lib/pools/distributable";

// Distribuições (reformulada 06/10/2026, mock aprovado): duas etapas (capital | lucro), linhas
// editáveis por sócio (pro rata / fora / valor próprio — a parte de quem fica fora FICA NO CAIXA
// por padrão), bloco de performance no lucro (% do acordo editável; provisionar / pagar / waiver
// com motivo), teste de caixa distribuível como GATE (override justificado) e prévia da posição.
// #69: o rateio é fato contábil; o WIRE de cada sócio é travado até a conta estar confirmada.

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const f2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parse = (s: string) => { const n = Number(s.replace(/[,$\s]/g, "")); return Number.isFinite(n) ? n : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type PayoutStatus = "NONE" | "PENDING" | "CONFIRMED";

export type DistLine = {
  lineId: string;
  name: string;
  amount: number;
  payoutStatus: PayoutStatus;
  mask: string; // ••1234 | —
  bankName: string;
  paidStatus: "UNPAID" | "PAID";
  paidAt: string | null;
};

export type DistRow = {
  id: string;
  date: string;
  kind: "RETURN_OF_CAPITAL" | "PROFIT";
  total: number;
  house: { id: string; address: string } | null;
  memo: string | null;
  overrideNote?: string | null;
  performance?: { status: string; amount: number; pct: number | null; description: string } | null;
  lines: DistLine[];
};

export type DistMember = {
  id: string;
  name: string;
  role: "MANAGER" | "INVESTOR";
  units: number;
  invested: number;
  receivedCapital: number;
  receivedProfit: number;
};

// espelha o rateio do server: pro rata por units, 2 casas, resíduo na maior posição
function split(total: number, members: DistMember[]): number[] {
  const totalUnits = members.reduce((s, m) => s + m.units, 0);
  if (totalUnits <= 0 || total <= 0) return members.map(() => 0);
  const amounts = members.map((m) => r2((total * m.units) / totalUnits));
  const residue = r2(total - amounts.reduce((s, v) => s + v, 0));
  if (residue !== 0 && amounts.length) {
    const i = amounts.indexOf(Math.max(...amounts));
    amounts[i] = r2(amounts[i] + residue);
  }
  return amounts;
}

export function PoolDistributionsTab({
  poolId, rows, houses, members, perf, gate, profitRealized, currency,
}: {
  poolId: string;
  rows: DistRow[];
  houses: Array<{ id: string; address: string }>;
  members: DistMember[]; // posição atual (units > 0) — preview; o rateio final usa as units na data
  perf: PerformanceSummary;
  gate: Distributable;
  profitRealized: number; // recebido − capital nas casas − despesas pagas (lucro do pool)
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const totals = useMemo(() => {
    const of = (k: string) => rows.filter((r) => r.kind === k).reduce((s, r) => s + r.total, 0);
    return { all: rows.reduce((s, r) => s + r.total, 0), roc: of("RETURN_OF_CAPITAL"), profit: of("PROFIT") };
  }, [rows]);
  void currency;

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Distribuições</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Antes do fim só devolução de capital, até o distribuível seguro. Lucro com todas as casas
              vendidas e loans quitados; a performance é decidida ali (provisionar, pagar, reduzir ou waiver).
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={`rounded-lg border px-3.5 py-1.5 text-xs font-semibold transition ${open ? "border-[#1f3a5f] bg-blue-50 text-[#1f3a5f]" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
          >
            + Distribuição
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-5">
          {([
            ["Total distribuído", totals.all, ""],
            ["Capital devolvido", totals.roc, members.length ? `${Math.round((totals.roc / Math.max(1, members.reduce((s, m) => s + m.invested, 0))) * 100)}% do aportado` : ""],
            ["Lucro distribuído", totals.profit, ""],
            ["Caixa do pool", gate.cash, ""],
            ["Distribuível seguro", Math.max(0, gate.safe), gate.safe < 0 ? "reservas acima do caixa" : `${gate.items.length} reservas`],
          ] as Array<[string, number, string]>).map(([label, v, sub]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
              <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-800">{money(v)}</div>
              {sub && <div className="text-[10.5px] text-slate-400">{sub}</div>}
            </div>
          ))}
        </div>

        {open && (
          <Builder poolId={poolId} houses={houses} members={members} perf={perf} gate={gate} profitRealized={profitRealized} rows={rows} />
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="w-8 px-3 py-2"></th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Data</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Tipo</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">Total</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Da venda de</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Memo / performance</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">Sócios</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-6 text-center text-sm text-slate-400">
                  Nenhuma distribuição ainda — quando a primeira casa vender, lance aqui a devolução de capital.
                </td>
              </tr>
            )}
            {rows.map((d) => <Row key={d.id} d={d} poolId={poolId} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Builder: capital | lucro, linhas editáveis, performance, gate ─────────────────────
function Builder({
  poolId, houses, members, perf, gate, profitRealized, rows,
}: {
  poolId: string;
  houses: Array<{ id: string; address: string }>;
  members: DistMember[];
  perf: PerformanceSummary;
  gate: Distributable;
  profitRealized: number;
  rows: DistRow[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(addDistribution.bind(null, poolId), undefined);
  const [kind, setKind] = useState<"RETURN_OF_CAPITAL" | "PROFIT">("RETURN_OF_CAPITAL");
  const capitalLeft = r2(members.reduce((s, m) => s + m.invested - m.receivedCapital, 0));
  const profitDone = rows.filter((r) => r.kind === "PROFIT").reduce((s, r) => s + r.total, 0);
  const [total, setTotal] = useState(f2(Math.max(0, Math.min(capitalLeft, gate.safe))));
  const [custom, setCustom] = useState<Record<string, number | null>>({});
  const [perfMode, setPerfMode] = useState<"PROVISION" | "PAY" | "WAIVE" | "NONE">(perf.agreedPct != null ? (gate.profitAllowed ? "PAY" : "PROVISION") : "NONE");
  const [perfPct, setPerfPct] = useState(perf.agreedPct != null ? String(perf.agreedPct) : "0");
  const [perfNote, setPerfNote] = useState("");
  const [settle, setSettle] = useState<"KEEP" | "PAY" | "WAIVE">("KEEP");
  const [override, setOverride] = useState("");

  const isProfit = kind === "PROFIT";
  const totalN = parse(total);
  const pct = Math.max(0, Math.min(100, parse(perfPct)));
  const perfAmount = isProfit && (perfMode === "PROVISION" || perfMode === "PAY") ? r2((totalN * pct) / 100) : 0;
  const waivedAmount = isProfit && perfMode === "WAIVE" ? r2((totalN * pct) / 100) : 0;
  const net = r2(totalN - perfAmount);
  const pro = split(net, members);
  const rec = members.map((m, i) => (custom[m.id] == null ? pro[i] : custom[m.id]!));
  const sumRec = r2(rec.reduce((s, v) => s + v, 0));
  const gap = r2(net - sumRec);
  const totalUnits = members.reduce((s, m) => s + m.units, 0);

  const overSafe = r2(totalN - gate.safe);
  const needsOverride = (isProfit && !gate.profitAllowed) || overSafe > 0.01;

  const switchKind = (k: "RETURN_OF_CAPITAL" | "PROFIT") => {
    setKind(k);
    setCustom({});
    setTotal(k === "PROFIT" ? f2(Math.max(0, r2(profitRealized - profitDone - perf.paid))) : f2(Math.max(0, Math.min(capitalLeft, gate.safe))));
  };
  const keepInPool = () => {
    // a parte de quem ficou fora fica no caixa: total vira a soma das linhas (+ performance no lucro)
    setTotal(f2(r2(sumRec + perfAmount)));
    setCustom((c) => { const n: Record<string, number | null> = { ...c }; members.forEach((m, i) => { if (n[m.id] == null) n[m.id] = rec[i]; }); return n; });
  };
  const redistribute = () => {
    const inIdx = members.map((_, i) => i).filter((i) => rec[i] !== 0);
    const u = inIdx.reduce((s, i) => s + members[i].units, 0);
    const n: Record<string, number | null> = { ...custom };
    inIdx.forEach((i) => (n[members[i].id] = r2((net * members[i].units) / u)));
    const s = inIdx.reduce((a, i) => a + (n[members[i].id] ?? 0), 0);
    if (inIdx.length) n[members[inIdx[0]].id] = r2((n[members[inIdx[0]].id] ?? 0) + (net - s));
    setCustom(n);
  };

  return (
    <form action={formAction} className="mt-3 rounded-lg border border-blue-100 bg-slate-50 p-4">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="perfMode" value={isProfit ? perfMode : "NONE"} />
      <input type="hidden" name="settleProvisioned" value={isProfit ? settle : "KEEP"} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
          {(["RETURN_OF_CAPITAL", "PROFIT"] as const).map((k) => (
            <button key={k} type="button" onClick={() => switchKind(k)} className={`px-3 py-1.5 text-xs font-semibold ${kind === k ? "bg-[#1f3a5f] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
              {k === "RETURN_OF_CAPITAL" ? "1 · Devolução de capital" : "2 · Lucro"}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-slate-400">
          capital ainda não devolvido {money(capitalLeft)} · lucro do pool {money(profitRealized)}{profitDone ? ` (já distribuído ${money(profitDone)})` : ""}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="w-40">
          <label className={labelClass}>Data</label>
          <input name="date" type="date" required className={inputClass} />
        </div>
        <div className="w-40">
          <label className={labelClass}>{isProfit ? "Lucro a distribuir" : "Total a devolver"}</label>
          <input name="totalAmount" value={total} onChange={(e) => setTotal(e.target.value)} required className={inputClass} />
        </div>
        <div className="min-w-44 flex-1">
          <label className={labelClass}>Da venda de (opcional)</label>
          <select name="houseId" defaultValue="" className={inputClass}>
            <option value="">—</option>
            {houses.map((h) => <option key={h.id} value={h.id}>{h.address}</option>)}
          </select>
        </div>
        <div className="min-w-40 flex-1">
          <label className={labelClass}>Memo</label>
          <input name="memo" className={inputClass} placeholder={isProfit ? "Lucro do projeto — encerramento" : "Devolução do principal"} />
        </div>
      </div>

      {/* gate de distribuível */}
      <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${needsOverride ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <b>Teste de caixa:</b> caixa {money(gate.cash)} − reservas {money(gate.cash - gate.safe)} = distribuível seguro <b>{money(Math.max(0, gate.safe))}</b>
            {overSafe > 0.01 && <> · este total passa em <b>{money(overSafe)}</b></>}
          </span>
          <details>
            <summary className="cursor-pointer underline">ver reservas</summary>
            <ul className="mt-1 space-y-0.5">
              {gate.items.length === 0 && <li>nenhuma reserva — projeto encerrado</li>}
              {gate.items.map((i) => <li key={i.key} className="flex justify-between gap-4"><span>{i.label}</span><b className="tabular-nums">{money(i.amount)}</b></li>)}
            </ul>
          </details>
        </div>
        {isProfit && !gate.profitAllowed && (
          <div className="mt-1">Lucro antes do fim: {gate.unsoldCount} casa(s) não vendida(s), {gate.openLoans} loan(s) em aberto — só com justificativa.</div>
        )}
        {needsOverride && (
          <div className="mt-2">
            <label className="mb-1 block text-[11px] font-semibold">Justificativa do override (fica gravada e auditada)</label>
            <input name="overrideNote" value={override} onChange={(e) => setOverride(e.target.value)} className={inputClass} placeholder="ex.: reserva coberta por aporte do Manager" />
          </div>
        )}
      </div>

      {/* performance — só no lucro */}
      {isProfit && (
        <div className={`mt-3 rounded-lg border px-3 py-3 ${perfMode === "WAIVE" ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[#1f3a5f]">Performance{perf.payeeName ? ` → ${perf.payeeName}` : ""}</div>
              <div className="text-[11px] text-slate-400">
                Acordo: <b>{perf.agreedPct != null ? `${perf.agreedPct}%` : "não cadastrado"}</b> do lucro{perf.timing === "PER_SALE" ? ", por venda" : perf.timing === "PROJECT_COMPLETION" ? ", no encerramento" : ""}.
                {perf.provisioned > 0 ? ` Já provisionado: ${money(perf.provisioned)}.` : ""}{perf.paid > 0 ? ` Já pago: ${money(perf.paid)}.` : ""}{perf.waived > 0 ? ` Waiver anterior: ${money(perf.waived)}.` : ""}
              </div>
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label className={labelClass}>% aplicado</label>
                <input name="perfPct" value={perfPct} onChange={(e) => setPerfPct(e.target.value)} disabled={perfMode === "NONE"} className={inputClass + " w-20 text-right"} />
              </div>
              <div>
                <label className={labelClass}>valor</label>
                <div className="py-2 text-base font-extrabold tabular-nums text-slate-800">{perfMode === "WAIVE" ? `$0.00 (waiver de ${money(waivedAmount)})` : money(perfAmount)}</div>
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {([
              ["PROVISION", "Provisionar (retém no caixa)"],
              ["PAY", "Pagar agora"],
              ["WAIVE", "Waiver — não cobrar"],
              ["NONE", "Sem performance nesta"],
            ] as const).map(([m, l]) => (
              <button key={m} type="button" onClick={() => setPerfMode(m)} className={`rounded-full border px-3 py-1 text-[11.5px] font-semibold ${perfMode === m ? (m === "WAIVE" ? "border-amber-500 bg-amber-500 text-white" : "border-[#1f3a5f] bg-[#1f3a5f] text-white") : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
                {l}
              </button>
            ))}
          </div>
          {(perfMode === "WAIVE" || pct !== (perf.agreedPct ?? pct)) && (
            <div className="mt-2">
              <label className={labelClass}>{perfMode === "WAIVE" ? "Motivo do waiver (report + auditoria)" : "Motivo do % diferente do acordo"}</label>
              <input name="perfNote" value={perfNote} onChange={(e) => setPerfNote(e.target.value)} className={inputClass} placeholder="ex.: retorno do projeto abaixo do esperado" />
            </div>
          )}
          {perf.provisioned > 0 && (
            <div className="mt-2 text-[11.5px] text-slate-600">
              Provisão acumulada de <b>{money(perf.provisioned)}</b> — nesta distribuição:{" "}
              {([["KEEP", "manter provisionada"], ["PAY", "pagar"], ["WAIVE", "waiver (volta aos sócios)"]] as const).map(([v, l]) => (
                <label key={v} className="mr-3 inline-flex items-center gap-1"><input type="radio" name="_settle" checked={settle === v} onChange={() => setSettle(v)} />{l}</label>
              ))}
            </div>
          )}
          <div className="mt-2 space-y-0.5 border-t border-dashed border-slate-200 pt-2 text-[12px]">
            <div className="flex justify-between"><span>Lucro a distribuir</span><b className="tabular-nums">{f2(totalN)}</b></div>
            <div className="flex justify-between"><span>− Performance ({perfMode === "WAIVE" ? `waiver · acordo ${perf.agreedPct ?? "—"}%` : perfMode === "NONE" ? "não aplicada" : `${pct}%`})</span><b className="tabular-nums text-red-700">{perfAmount ? "−" + f2(perfAmount) : "0.00"}</b></div>
            <div className="flex justify-between font-bold"><span>= Lucro aos sócios (pro rata às units)</span><b className="tabular-nums">{f2(net)}</b></div>
          </div>
        </div>
      )}

      {/* linhas por sócio */}
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[10.5px] uppercase tracking-wider text-slate-400">
              <th className="px-3 py-2 font-medium">Sócio</th>
              <th className="px-2 py-2 text-right font-medium">% units</th>
              <th className="px-2 py-2 text-right font-medium">Pro rata</th>
              <th className="px-2 py-2 text-right font-medium">Vai receber</th>
              <th className="px-2 py-2 font-medium"></th>
              <th className="px-2 py-2 text-right font-medium">Já recebeu</th>
              <th className="px-2 py-2 text-right font-medium">Após esta</th>
            </tr>
          </thead>
          <tbody className="text-[12.5px]">
            {members.map((m, i) => {
              const prior = m.receivedCapital + m.receivedProfit;
              const diff = rec[i] - pro[i];
              const st = rec[i] === 0 ? ["fora desta", "bg-red-50 text-red-700"] : Math.abs(diff) < 0.005 ? ["pro rata", "bg-emerald-50 text-emerald-700"] : ["ajustado", "bg-amber-50 text-amber-800"];
              return (
                <tr key={m.id} className="border-b border-slate-50">
                  <td className="px-3 py-1.5 text-slate-700">{m.name}{m.role === "MANAGER" && <span className="ml-1 rounded-full bg-blue-50 px-1.5 text-[10px] font-semibold text-[#1f3a5f]">Manager</span>}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{((m.units / totalUnits) * 100).toFixed(2)}%</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{f2(pro[i])}</td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      name={`line:${m.id}`}
                      value={f2(rec[i])}
                      onChange={(e) => setCustom((c) => ({ ...c, [m.id]: parse(e.target.value) }))}
                      className={`w-28 rounded border px-2 py-1 text-right text-[12.5px] tabular-nums outline-none focus:border-[#1f3a5f] ${Math.abs(diff) >= 0.005 ? "border-amber-400 bg-amber-50" : "border-slate-300"}`}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${st[1]}`}>{st[0]}</span>
                    <button type="button" onClick={() => setCustom((c) => ({ ...c, [m.id]: 0 }))} className="ml-1 rounded border border-slate-300 px-1.5 text-[10.5px] text-slate-500 hover:bg-slate-50">fora</button>
                    <button type="button" onClick={() => setCustom((c) => ({ ...c, [m.id]: null }))} className="ml-1 rounded border border-slate-300 px-1.5 text-[10.5px] text-slate-500 hover:bg-slate-50">pro rata</button>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{f2(prior)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{f2(prior + rec[i])}</td>
                </tr>
              );
            })}
            <tr className="bg-slate-50 font-semibold">
              <td className="px-3 py-1.5">Total</td>
              <td className="px-2 py-1.5 text-right">100%</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{f2(net)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{f2(sumRec)}</td>
              <td></td>
              <td className="px-2 py-1.5 text-right tabular-nums">{f2(members.reduce((s, m) => s + m.receivedCapital + m.receivedProfit, 0))}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{f2(members.reduce((s, m) => s + m.receivedCapital + m.receivedProfit, 0) + sumRec)}</td>
            </tr>
          </tbody>
        </table>
        <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs ${Math.abs(gap) < 0.005 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
          {Math.abs(gap) < 0.005 ? (
            <span>✓ As linhas fecham com o total{isProfit && perfAmount ? " líquido de performance" : ""} ({f2(net)}).</span>
          ) : gap > 0 ? (
            <>
              <span>Sobram <b>{f2(gap)}</b> das linhas zeradas/ajustadas. O que fazer?</span>
              <span className="flex gap-1.5">
                <button type="button" onClick={keepInPool} className="rounded border border-[#1f3a5f] bg-[#1f3a5f] px-2 py-0.5 font-semibold text-white">fica no caixa do pool (total vira {f2(sumRec + perfAmount)})</button>
                <button type="button" onClick={redistribute} className="rounded border border-[#1f3a5f] bg-white px-2 py-0.5 font-semibold text-[#1f3a5f]">redistribuir pro rata entre quem ficou</button>
              </span>
            </>
          ) : (
            <span>As linhas passam do total em <b>{f2(-gap)}</b>.</span>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || totalN <= 0 || Math.abs(gap) >= 0.005 || (needsOverride && !override.trim()) || (isProfit && perfMode === "WAIVE" && !perfNote.trim())}
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
        >
          {pending ? "Distribuindo…" : "Confirmar distribuição"}
        </button>
        <span className="text-[11px] text-slate-400">Cada linha vira wire travado até a conta do sócio estar confirmada (#69). Preview pela posição atual — o rateio final usa as units na data.</span>
      </div>
      {state?.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

const STATUS_PILL: Record<PayoutStatus, { label: string; cls: string }> = {
  CONFIRMED: { label: "Confirmada", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  PENDING: { label: "Pendente", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  NONE: { label: "Sem conta", cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

const PERF_PILL: Record<string, [string, string]> = {
  PAID: ["performance paga", "bg-slate-100 text-slate-700"],
  PROVISIONED: ["performance provisionada", "bg-blue-50 text-[#1f3a5f]"],
  WAIVED: ["performance: waiver", "bg-amber-50 text-amber-800"],
};

// linha expansível: clica e vê o rateio + o PAGAMENTO por sócio (travado até a conta confirmada)
function Row({ d, poolId }: { d: DistRow; poolId: string }) {
  const [open, setOpen] = useState(false);
  const paidCount = d.lines.filter((l) => l.paidStatus === "PAID").length;
  const allPaid = d.lines.length > 0 && paidCount === d.lines.length;
  return (
    <>
      <tr onClick={() => setOpen((v) => !v)} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/60">
        <td className="px-3 py-2 text-center text-xs text-slate-400">{open ? "▾" : "▸"}</td>
        <td className="px-3 py-2 text-sm text-slate-500">{d.date}</td>
        <td className="px-3 py-2">
          {d.kind === "RETURN_OF_CAPITAL" ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] text-slate-600">Retorno de capital</span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] text-emerald-700">Lucro</span>
          )}
        </td>
        <td className="px-3 py-2 text-right text-sm font-medium tabular-nums text-slate-800">{money(d.total)}</td>
        <td className="px-3 py-2">
          {d.house ? (
            <Link href={`/pools/${poolId}/houses/${d.house.id}`} onClick={(e) => e.stopPropagation()} className="rounded-full bg-blue-50 px-2 py-0.5 text-[10.5px] font-medium text-[#1f3a5f] hover:bg-blue-100">
              {d.house.address}
            </Link>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-slate-400">
          {d.memo ?? ""}
          {d.performance && (
            <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${PERF_PILL[d.performance.status]?.[1] ?? ""}`} title={d.performance.description}>
              {PERF_PILL[d.performance.status]?.[0] ?? d.performance.status}{d.performance.pct != null ? ` ${d.performance.pct}%` : ""} · {money(d.performance.amount)}
            </span>
          )}
          {d.overrideNote && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800" title={d.overrideNote}>override</span>}
        </td>
        <td className="px-3 py-2 text-right">
          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium tabular-nums ${allPaid ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`} title="Wires enviados / total de sócios">
            {paidCount}/{d.lines.length} pagos
          </span>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-slate-100 bg-slate-50/50">
          <td></td>
          <td colSpan={6} className="px-3 py-3">
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="w-full">
                <tbody>{d.lines.map((l) => <PaymentRow key={l.lineId} l={l} />)}</tbody>
              </table>
            </div>
            <form action={deleteDistribution} className="mt-2">
              <input type="hidden" name="distributionId" value={d.id} />
              <button type="submit" className="text-[11px] text-slate-300 underline hover:text-red-600">apagar esta distribuição</button>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

// Uma linha de sócio dentro da distribuição: valor + status da conta + pagamento (com trava).
function PaymentRow({ l }: { l: DistLine }) {
  const [confirming, setConfirming] = useState(false);
  const [ref, setRef] = useState("");
  const [pending, start] = useTransition();
  const [state, setState] = useState<PayoutFormState>(undefined);
  const action = (fd: FormData) =>
    start(async () => {
      const res = await markLinePaid(undefined, fd);
      setState(res);
      if (res?.ok) setConfirming(false);
    });

  const pill = STATUS_PILL[l.payoutStatus];
  const canPay = l.payoutStatus === "CONFIRMED";
  const paid = l.paidStatus === "PAID";

  return (
    <tr className="border-b border-slate-50 last:border-0">
      <td className="px-3 py-2 text-xs text-slate-700">{l.name}</td>
      <td className="px-3 py-2 text-right text-xs font-medium tabular-nums text-slate-800" style={{ width: 110 }}>{money(l.amount)}</td>
      <td className="px-3 py-2" style={{ width: 150 }}>
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${pill.cls}`}>{pill.label}</span>
          {l.payoutStatus !== "NONE" && <span className="text-[10.5px] tabular-nums text-slate-400">{l.mask}</span>}
        </div>
      </td>
      <td className="px-3 py-2 text-right" style={{ width: 200 }}>
        {paid ? (
          <div className="flex items-center justify-end gap-2">
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700">wire enviado{l.paidAt ? ` · ${l.paidAt}` : ""}</span>
            <form action={unmarkLinePaid}>
              <input type="hidden" name="lineId" value={l.lineId} />
              <button type="submit" className="text-[10.5px] text-slate-300 underline hover:text-red-500" title="Desfazer">desfazer</button>
            </form>
          </div>
        ) : !confirming ? (
          <div className="flex flex-col items-end">
            <button type="button" disabled={!canPay} onClick={() => setConfirming(true)} className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${canPay ? "border-[#1f3a5f] text-[#1f3a5f] hover:bg-blue-50" : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300"}`}>
              Marcar wire enviado
            </button>
            {!canPay && <span className="mt-0.5 text-[10px] text-slate-400">{l.payoutStatus === "NONE" ? "sócio sem conta cadastrada" : "aguarda o sócio confirmar no portal"}</span>}
          </div>
        ) : (
          // conferência: 2º par de olhos do operador antes de confirmar o envio
          <form action={action} className="inline-flex items-center gap-1.5">
            <input type="hidden" name="lineId" value={l.lineId} />
            <div className="text-right">
              <div className="text-[10px] text-slate-400">{money(l.amount)} → {l.bankName} {l.mask}</div>
              <input name="paidRef" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="ref. do wire (opcional)" className="mt-0.5 w-40 rounded border border-slate-300 px-2 py-1 text-[11px] outline-none focus:border-[#1f3a5f]" />
            </div>
            <button type="submit" disabled={pending} className="rounded-lg bg-[#1f3a5f] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#16304f] disabled:opacity-60">{pending ? "…" : "Confirmar"}</button>
            <button type="button" onClick={() => setConfirming(false)} className="text-[11px] text-slate-400 hover:text-slate-600">✕</button>
          </form>
        )}
        {state?.error && <p className="mt-1 text-[10.5px] text-red-600">{state.error}</p>}
      </td>
    </tr>
  );
}
