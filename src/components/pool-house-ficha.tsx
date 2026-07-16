"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setHouseStatus, updateHouse, type FormState } from "@/lib/actions/pools";

// Ficha da casa (mock UX 1/6 aprovado 16/07): identidade + stepper de status no topo,
// KPIs, Planejado × Real × Δ lado a lado, banco e linha do tempo em cards, save fixa.

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

const STATUSES = [
  ["PLANNED", "Planned"],
  ["LOT_PURCHASED", "Lot purchased"],
  ["UNDER_CONSTRUCTION", "Under construction"],
  ["FOR_SALE", "For sale"],
  ["UNDER_CONTRACT", "Under contract"],
  ["SOLD", "Sold"],
] as const;

export type FichaValues = {
  id: string;
  poolId: string;
  address: string;
  status: string;
  catalogModelId: string;
  catalogLocationId: string;
  loanId: string;
  plannedLotCost: string;
  plannedBuildCost: string;
  plannedSalePrice: string;
  plannedClosingCost: string;
  bankName: string;
  bankLoanAmount: string;
  bankOriginationFee: string;
  bankInterestReserve: string;
  bankCashToClose: string;
  bankBudgetReviewFee: string;
  bankCharges: string;
  actualLotCost: string;
  actualBuildCost: string;
  ownCapital: string;
  soldPrice: string;
  payoffAmount: string;
  netReceived: string;
  closingCost: string;
  contractDate: string;
  saleDate: string;
  lotContractDate: string;
  lotPaidDate: string;
  buildStartDate: string;
  coDate: string;
  notes: string;
};

export type FichaCatalog = {
  locations: Array<{ id: string; name: string }>;
  modelLocations: Array<{ locationId: string; modelId: string; modelName: string }>;
};

// string do input ("46,500.00") → número ou null
const p = (s: string): number | null => {
  const t = s.replace(/,/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const fmt = (n: number) =>
  "$" + Math.round(n).toLocaleString("en-US");
const fmtSigned = (n: number) => (n < 0 ? "−" : "+") + fmt(Math.abs(n));

function Delta({ value, goodWhenNegative }: { value: number | null; goodWhenNegative: boolean }) {
  if (value == null) return <span className="text-xs text-slate-400">—</span>;
  if (Math.round(value) === 0) return <span className="text-xs text-slate-400">=</span>;
  const good = goodWhenNegative ? value < 0 : value > 0;
  return (
    <span className={`text-sm font-semibold tabular-nums ${good ? "text-emerald-700" : "text-red-700"}`}>
      {fmtSigned(value)} {good ? "✓" : ""}
    </span>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-800">{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

export function PoolHouseFicha({
  values,
  catalog,
  loans,
  crumb,
  loanHref,
  drawsTotal,
  coTotal,
  coCount,
  changeOrders,
  dangerZone,
}: {
  values: FichaValues;
  catalog: FichaCatalog;
  loans: Array<{ id: string; label: string }>;
  crumb: string;
  loanHref: string;
  drawsTotal: number;
  coTotal: number;
  coCount: number;
  // server-rendered, com forms próprias — ficam FORA do <form> principal (abas via CSS)
  changeOrders?: React.ReactNode;
  dangerZone?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateHouse.bind(null, values.id),
    undefined,
  );
  const router = useRouter();
  const [form, setForm] = useState(values);
  const [baseline, setBaseline] = useState(values);
  const [savedFlash, setSavedFlash] = useState(false);
  // sub-abas (aprovado 16/07): cabeçalho + KPIs sempre visíveis; o miolo troca sem rolagem.
  // Painéis ficam MONTADOS (CSS hidden) — edições não salvas sobrevivem à troca de aba e
  // inputs escondidos continuam entrando no submit.
  const [pane, setPane] = useState<"num" | "banco" | "co" | "notas">("num");
  const [statusPending, startStatus] = useTransition();
  const lastOk = useRef<number | undefined>(undefined);

  // salvou → baseline vira o estado atual e mostra "Salvo ✓" por alguns segundos
  useEffect(() => {
    if (state?.ok && state.ok !== lastOk.current) {
      lastOk.current = state.ok;
      setBaseline(form);
      setSavedFlash(true);
      const t = setTimeout(() => setSavedFlash(false), 3000);
      router.refresh();
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // após router.refresh() o server manda values novos (carimbo de data do stepper, closing
  // derivado no save) — adota nos campos que o usuário não editou; edição em curso prevalece
  useEffect(() => {
    const changed = (Object.keys(values) as Array<keyof FichaValues>).filter((k) => values[k] !== baseline[k]);
    if (changed.length === 0) return;
    setForm((f) => {
      const next = { ...f };
      for (const k of changed) if (f[k] === baseline[k]) next[k] = values[k];
      return next;
    });
    setBaseline((b) => {
      const next = { ...b };
      for (const k of changed) next[k] = values[k];
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const set = (k: keyof FichaValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const dirty = useMemo(
    () => (Object.keys(form) as Array<keyof FichaValues>).filter((k) => form[k] !== baseline[k]).length,
    [form, baseline],
  );

  const availableModels = useMemo(
    () => catalog.modelLocations.filter((ml) => ml.locationId === form.catalogLocationId),
    [catalog.modelLocations, form.catalogLocationId],
  );
  const modelName = catalog.modelLocations.find((ml) => ml.modelId === form.catalogModelId)?.modelName ?? null;
  const locationName = catalog.locations.find((l) => l.id === form.catalogLocationId)?.name ?? null;
  const loanLabel = loans.find((l) => l.id === form.loanId)?.label ?? null;

  // ── números vivos (recalculam enquanto digita) ──
  const plLot = p(form.plannedLotCost);
  const plBuild = p(form.plannedBuildCost);
  const plSale = p(form.plannedSalePrice);
  const plClosing = p(form.plannedClosingCost);
  const plCost = plLot == null && plBuild == null ? null : (plLot ?? 0) + (plBuild ?? 0) + (plClosing ?? 0);
  const plProfit = plSale == null || plCost == null ? null : plSale - plCost;

  const aLot = p(form.actualLotCost);
  const aBuild = p(form.actualBuildCost);
  const aSale = p(form.soldPrice);
  const aPayoff = p(form.payoffAmount);
  const aNet = p(form.netReceived);
  // closing real: digitado, ou derivado (venda − payoff − recebido) — mesma regra do server
  const aClosing =
    p(form.closingCost) ?? (aSale != null && aPayoff != null && aNet != null ? aSale - aPayoff - aNet : null);
  const aProfit =
    aSale == null || (aLot == null && aBuild == null)
      ? null
      : aSale - (aClosing ?? 0) - (aLot ?? 0) - (aBuild ?? 0) - coTotal;

  const loanAmount = p(form.bankLoanAmount);
  // mesma regra do houseEconomics: custo pro forma (lote+obra+closing) − loan
  const ownNeeded = plCost == null ? null : plCost - (loanAmount ?? 0);
  const ownUsed = p(form.ownCapital);

  const pendingReal = [aLot, aBuild, aSale, aNet].filter((v) => v == null).length;
  const soldish = form.status === "UNDER_CONTRACT" || form.status === "SOLD";

  const statusIdx = STATUSES.findIndex(([v]) => v === form.status);

  // clicar num passo carimba o FATO (data) — o status volta DERIVADO do server (16/07);
  // sem otimismo local: se faltar o dado (ex.: Sold sem preço), o status honesto não sobe
  const stepTo = (status: string) => {
    startStatus(async () => {
      await setHouseStatus(values.id, status as never);
      router.refresh();
    });
  };

  // % de conclusão da obra pelos RECEBIMENTOS do banco (pedido A): CO emitido = 100%
  const buildPct =
    form.coDate !== ""
      ? 100
      : loanAmount != null && loanAmount > 0
        ? Math.min(100, Math.round((drawsTotal / loanAmount) * 100))
        : null;

  const subtab = (key: typeof pane, label: string, badge?: number) => (
    <button
      key={key}
      type="button"
      onClick={() => setPane(key)}
      className={`-mb-0.5 rounded-t-lg border-b-2 px-4 py-2 text-sm transition ${
        pane === key
          ? "border-[#1f3a5f] font-semibold text-[#1f3a5f]"
          : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700"
      }`}
    >
      {label}
      {badge != null && badge > 0 && (
        <span
          className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
            pane === key ? "bg-blue-50 text-[#1f3a5f]" : "bg-slate-100 text-slate-500"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );

  return (
    <>
      <form id="ficha-form" action={formAction} className="space-y-4">
        {/* 1. identidade + status */}
        <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
          <Link href={`/pools/${values.poolId}?tab=houses`} className="text-xs text-slate-500 hover:text-slate-700">
            ← {crumb}
          </Link>
          <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <input
                name="address"
                required
                value={form.address}
                onChange={set("address")}
                className="w-full rounded-lg border border-transparent px-2 py-1 -ml-2 text-xl font-semibold text-slate-800 outline-none hover:border-slate-200 focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20"
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-0.5">
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-600">
                  {modelName && locationName ? `${modelName} · ${locationName}` : "modelo/localização a definir"}
                </span>
                {loanLabel ? (
                  <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-[#1f3a5f]">
                    🏦 {loanLabel}
                    {loanAmount != null ? ` · ${fmt(loanAmount)}` : ""}
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-500">100% equity</span>
                )}
                {pendingReal > 0 && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                    {pendingReal} {pendingReal === 1 ? "campo real pendente" : "campos reais pendentes"}
                  </span>
                )}
              </div>
              <details className="mt-2 px-0.5">
                <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-600">
                  ✎ trocar modelo / localização
                </summary>
                <div className="mt-2 grid max-w-md grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Localização</label>
                    <select
                      name="catalogLocationId"
                      value={form.catalogLocationId}
                      onChange={(e) => {
                        const loc = e.target.value;
                        setForm((f) => ({
                          ...f,
                          catalogLocationId: loc,
                          // modelo só permanece se existir na nova localização
                          catalogModelId: catalog.modelLocations.some(
                            (ml) => ml.locationId === loc && ml.modelId === f.catalogModelId,
                          )
                            ? f.catalogModelId
                            : "",
                        }));
                      }}
                      className={inputClass}
                    >
                      <option value="">—</option>
                      {catalog.locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Modelo (simulador)</label>
                    <select
                      name="catalogModelId"
                      value={form.catalogModelId}
                      onChange={set("catalogModelId")}
                      disabled={!form.catalogLocationId}
                      className={inputClass}
                    >
                      <option value="">{form.catalogLocationId ? "—" : "escolha a localização"}</option>
                      {availableModels.map((ml) => (
                        <option key={ml.modelId} value={ml.modelId}>
                          {ml.modelName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </details>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-slate-400">Lucro previsto</div>
              <div className="text-2xl font-extrabold tabular-nums text-[#1f3a5f]">
                {plProfit != null ? fmt(plProfit) : "—"}
              </div>
            </div>
          </div>
          {/* stepper — clicar CARIMBA O FATO (data do passo); o status é derivado dos fatos.
              Voltar = apagar a data na Linha do tempo (corrige-se o fato, não o rótulo). */}
          <div className="mt-3 flex gap-1">
            {STATUSES.map(([v, l], i) => (
              <button
                key={v}
                type="button"
                onClick={() => stepTo(v)}
                disabled={statusPending}
                title={
                  i < statusIdx
                    ? "Fase concluída — para voltar, apague a data correspondente na Linha do tempo"
                    : i === statusIdx
                      ? "Fase atual (derivada das atividades: lote, draws, CO, contrato, venda)"
                      : "Clique para registrar o fato — a data do passo é carimbada e a fase avança"
                }
                className={`flex-1 rounded-md px-1 py-1.5 text-[10.5px] transition ${
                  i === statusIdx
                    ? "bg-[#1f3a5f] font-bold text-white"
                    : i < statusIdx
                      ? "bg-emerald-100 font-semibold text-emerald-700 hover:bg-emerald-200"
                      : "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                }`}
              >
                {l}
                {v === "UNDER_CONSTRUCTION" && statusIdx === i && buildPct != null && (
                  <b> · {buildPct}%</b>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* 2. KPIs */}
        <section className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Kpi label="Capital próprio (prev.)" value={ownNeeded != null ? fmt(ownNeeded) : "—"} sub="pro forma − loan" />
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <label htmlFor="ficha-ownCapital" className="block text-[10px] font-medium uppercase tracking-wider text-slate-400">
              Capital próprio usado
            </label>
            <input
              id="ficha-ownCapital"
              name="ownCapital"
              value={form.ownCapital}
              onChange={set("ownCapital")}
              placeholder="—"
              className="mt-0.5 w-full rounded border border-transparent bg-transparent px-1 -ml-1 text-lg font-bold tabular-nums text-slate-800 outline-none hover:border-slate-300 focus:border-[#1f3a5f] focus:bg-white"
            />
            <div className="text-[11px] text-slate-400">
              {ownUsed != null && ownNeeded != null && ownNeeded > 0
                ? `${Math.round((ownUsed / ownNeeded) * 100)}% do previsto`
                : "editável"}
            </div>
          </div>
          <Kpi
            label="Loan aprovado"
            value={loanAmount != null ? fmt(loanAmount) : "—"}
            sub={form.bankName || loanLabel || undefined}
          />
          <Kpi
            label="Draws feitos"
            value={fmt(drawsTotal)}
            sub={loanAmount != null ? `saldo ${fmt(loanAmount - drawsTotal)}` : undefined}
          />
          <Kpi label="Change orders" value={(coTotal >= 0 ? "+" : "−") + fmt(Math.abs(coTotal))} sub={`${coCount} lançados`} />
        </section>

        {/* sub-abas (aprovado 16/07): zero rolagem — o miolo troca, cabeçalho e KPIs ficam */}
        <div className="flex gap-1 border-b-2 border-slate-200">
          {subtab("num", "📊 Números")}
          {subtab("banco", "🏦 Banco & prazos")}
          {subtab("co", "📝 Change orders", coCount)}
          {subtab("notas", "⋯ Notas & ações")}
        </div>

        {/* 3. planejado × real × Δ — o coração da ficha */}
        <section className={`rounded-xl border border-slate-200 bg-white px-5 py-4 ${pane === "num" ? "" : "hidden"}`}>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Números — planejado × real</h2>
          <table className="mt-2 w-full">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10.5px] uppercase tracking-wider text-slate-400">
                <th className="py-1.5 pr-2 font-medium" style={{ width: "24%" }}></th>
                <th className="py-1.5 pr-2 text-right font-medium">Planejado</th>
                <th className="py-1.5 pr-2 text-right font-medium">Real</th>
                <th className="py-1.5 pr-2 text-right font-medium">Δ</th>
                <th className="py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {(
                [
                  ["Lote", plLot, "actualLotCost", aLot, true, form.lotPaidDate ? `pago ${form.lotPaidDate}` : ""],
                  ["Obra", plBuild, "actualBuildCost", aBuild, true, "draws + capital próprio"],
                  ["Venda", plSale, "soldPrice", aSale, false, form.saleDate ? `closing ${form.saleDate}` : ""],
                  [
                    "Closing da venda",
                    plClosing,
                    "closingCost",
                    aClosing,
                    true,
                    p(form.closingCost) == null && aClosing != null ? "derivado: venda − payoff − recebido" : "= venda − payoff − recebido",
                  ],
                ] as Array<[string, number | null, keyof FichaValues, number | null, boolean, string]>
              ).map(([label, plan, field, actual, costRow, note]) => (
                <tr key={field} className="border-b border-slate-50">
                  <td className="py-1.5 pr-2 font-semibold text-slate-700">{label}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-slate-500">{plan != null ? fmt(plan) : "—"}</td>
                  <td className="py-1.5 pr-2 text-right">
                    <input
                      name={field}
                      value={form[field]}
                      onChange={set(field)}
                      placeholder="—"
                      className="w-32 rounded-lg border border-slate-300 px-2.5 py-1.5 text-right text-sm tabular-nums outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20"
                    />
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    <Delta value={plan != null && actual != null ? actual - plan : null} goodWhenNegative={costRow} />
                  </td>
                  <td className="py-1.5 text-[11px] text-slate-400">{note}</td>
                </tr>
              ))}
              {/* payoff e recebido aparecem quando a casa está em contrato/vendida (ou já têm valor) */}
              {(soldish || form.payoffAmount || form.netReceived) && (
                <>
                  <tr className="border-b border-slate-50">
                    <td className="py-1.5 pr-2 font-semibold text-slate-700">Payoff banco</td>
                    <td className="py-1.5 pr-2 text-right text-slate-400">—</td>
                    <td className="py-1.5 pr-2 text-right">
                      <input
                        name="payoffAmount"
                        value={form.payoffAmount}
                        onChange={set("payoffAmount")}
                        placeholder="—"
                        className="w-32 rounded-lg border border-slate-300 px-2.5 py-1.5 text-right text-sm tabular-nums outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20"
                      />
                    </td>
                    <td></td>
                    <td className="py-1.5 text-[11px] text-slate-400">quitação do loan na venda</td>
                  </tr>
                  <tr className="border-b border-slate-50">
                    <td className="py-1.5 pr-2 font-semibold text-slate-700">Recebido em conta</td>
                    <td className="py-1.5 pr-2 text-right text-slate-400">—</td>
                    <td className="py-1.5 pr-2 text-right">
                      <input
                        name="netReceived"
                        value={form.netReceived}
                        onChange={set("netReceived")}
                        placeholder="—"
                        className="w-32 rounded-lg border border-slate-300 px-2.5 py-1.5 text-right text-sm tabular-nums outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20"
                      />
                    </td>
                    <td></td>
                    <td className="py-1.5 text-[11px] text-slate-400">o que entrou no closing</td>
                  </tr>
                </>
              )}
              <tr className="bg-slate-50 font-bold">
                <td className="py-2 pr-2 text-slate-800">Lucro</td>
                <td className="py-2 pr-2 text-right tabular-nums text-slate-700">{plProfit != null ? fmt(plProfit) : "—"}</td>
                <td className="py-2 pr-2 text-right tabular-nums text-slate-800">{aProfit != null ? fmt(aProfit) : "—"}</td>
                <td className="py-2 pr-2 text-right">
                  <Delta value={plProfit != null && aProfit != null ? aProfit - plProfit : null} goodWhenNegative={false} />
                </td>
                <td className="py-2 text-[11px] font-normal text-slate-400">calculado, nunca digitado{coTotal !== 0 ? " · inclui change orders" : ""}</td>
              </tr>
            </tbody>
          </table>
          {!soldish && !form.payoffAmount && !form.netReceived && (
            <p className="mt-2 text-[11px] text-slate-400">
              Payoff e &quot;recebido em conta&quot; aparecem aqui quando o status chegar em Under contract / Sold.
            </p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-600">
              De onde vem o planejado? (ajustar pro forma)
            </summary>
            <p className="mt-2 text-[11px] text-slate-400">
              O pro forma veio da simulação de origem na conversão do pool. Ajuste só se a premissa da casa mudou de fato.
            </p>
            <div className="mt-2 grid max-w-2xl grid-cols-2 gap-3 md:grid-cols-4">
              {(
                [
                  ["plannedLotCost", "Lote (plan.)"],
                  ["plannedBuildCost", "Obra (plan.)"],
                  ["plannedSalePrice", "Venda (plan.)"],
                  ["plannedClosingCost", "Closing (plan.)"],
                ] as Array<[keyof FichaValues, string]>
              ).map(([field, label]) => (
                <div key={field}>
                  <label className={labelClass}>{label}</label>
                  <input name={field} value={form[field]} onChange={set(field)} className={inputClass} />
                </div>
              ))}
            </div>
          </details>
        </section>

        {/* 4/5. banco & loan + linha do tempo */}
        <section className={`grid gap-4 md:grid-cols-2 ${pane === "banco" ? "" : "hidden"}`}>
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Banco &amp; loan</h2>
            <div className="mt-3">
              <label className={labelClass}>Loan da casa</label>
              <select name="loanId" value={form.loanId} onChange={set("loanId")} className={inputClass}>
                <option value="">— (100% equity)</option>
                {loans.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(
                [
                  ["bankName", "Bank"],
                  ["bankLoanAmount", "Original loan"],
                  ["bankOriginationFee", "Origination fee"],
                  ["bankInterestReserve", "Interest reserve"],
                  ["bankCashToClose", "Cash to close"],
                  ["bankBudgetReviewFee", "Budget review fee"],
                  ["bankCharges", "Bank charges"],
                ] as Array<[keyof FichaValues, string]>
              ).map(([field, label]) => (
                <div key={field}>
                  <label className={labelClass}>{label}</label>
                  <input name={field} value={form[field]} onChange={set(field)} className={inputClass} />
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-slate-400">
              Draws e extrato desta casa →{" "}
              <Link href={loanHref} className="underline hover:text-slate-600">
                Loan statement
              </Link>
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Linha do tempo</h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(
                [
                  ["lotContractDate", "Contrato do lote"],
                  ["lotPaidDate", "Lote pago"],
                  ["buildStartDate", "Início da obra"],
                  ["coDate", "CO"],
                  ["contractDate", "Contrato de venda"],
                  ["saleDate", "Venda (closing)"],
                ] as Array<[keyof FichaValues, string]>
              ).map(([field, label]) => (
                <div key={field}>
                  <label className={labelClass}>{label}</label>
                  <input type="date" name={field} value={form[field]} onChange={set(field)} className={inputClass} />
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-slate-400">
              O stepper carimba a data do passo automaticamente — ajuste aqui se precisar. Alimenta o simulado × realizado.
            </p>
          </div>
        </section>

        {/* notas */}
        <section className={`rounded-xl border border-slate-200 bg-white px-5 py-4 ${pane === "notas" ? "" : "hidden"}`}>
          <label htmlFor="ficha-notes" className={labelClass}>
            Notas
          </label>
          <textarea id="ficha-notes" name="notes" rows={2} value={form.notes} onChange={set("notes")} className={inputClass} />
        </section>
      </form>

      {/* server-rendered com forms próprias — fora do <form> principal, toggle por aba */}
      <div className={pane === "co" ? "" : "hidden"}>{changeOrders}</div>
      <div className={pane === "notas" ? "" : "hidden"}>{dangerZone}</div>

      {/* save fixa — fora do form (fim do layout); o submit aponta via form="ficha-form" */}
      <div className="sticky bottom-3 z-10 mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 px-5 py-3 shadow-lg backdrop-blur">
        <span className="text-xs text-slate-400">
          {state?.error ? (
            <span className="text-red-600">{state.error}</span>
          ) : savedFlash ? (
            <span className="font-medium text-emerald-700">Salvo ✓</span>
          ) : dirty > 0 ? (
            `${dirty} ${dirty === 1 ? "alteração não salva" : "alterações não salvas"}`
          ) : (
            "tudo salvo"
          )}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setForm(baseline)}
            disabled={dirty === 0}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          >
            Descartar
          </button>
          <button
            type="submit"
            form="ficha-form"
            disabled={pending}
            className="rounded-lg bg-[#1f3a5f] px-5 py-2 text-sm font-semibold text-white hover:bg-[#16304f] disabled:opacity-60"
          >
            {pending ? "Salvando…" : "Salvar casa"}
          </button>
        </div>
      </div>
    </>
  );
}
