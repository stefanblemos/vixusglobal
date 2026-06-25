import { formatMoney } from "@/lib/money";
import type { DepReconciliation, ReconStatus } from "@/lib/assets/reconcile-dep";

const STATUS: Record<ReconStatus, { label: string; cls: string }> = {
  ok: { label: "ok", cls: "bg-green-50 text-green-700" },
  faltou: { label: "não lançou", cls: "bg-red-50 text-red-700" },
  diferente: { label: "diverge", cls: "bg-amber-50 text-amber-700" },
  "sem-ir": { label: "sem IR", cls: "bg-slate-100 text-slate-500" },
  na: { label: "—", cls: "text-slate-300" },
};

export function DepReconcile({
  companies,
  data,
  reconCompanyId,
}: {
  companies: { id: string; legalName: string }[];
  data: DepReconciliation | null;
  reconCompanyId: string;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-medium text-slate-800">Conferência da depreciação (por ano)</h2>
        <p className="text-sm text-slate-500">
          O que o MACRS diz que <strong>deveria</strong> ter sido depreciado em cada ano × o que foi
          lançado no IR. Use o catch-up para alinhar o próximo IR (e o QBO) ao cálculo do app.
        </p>
      </div>

      <form action="/assets" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="recon" value="" />
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Empresa</span>
          <select name="recon" defaultValue={reconCompanyId} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.legalName}</option>
            ))}
          </select>
        </label>
        <button className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]">Conferir</button>
      </form>

      {!data ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">
          Cadastre ativos (acima) para conferir a depreciação por ano.
        </p>
      ) : (
        <>
          {/* Headline: o catch-up */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">MACRS acumulada — deveria (até {data.throughYear})</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{formatMoney(data.macrsAccumThrough, "USD")}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Lançado no IR até agora</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{formatMoney(data.irToDate, "USD")}</div>
              {data.irYearsMissing.length > 0 && (
                <div className="mt-1 text-[11px] text-amber-600">sem IR nos anos: {data.irYearsMissing.join(", ")}</div>
              )}
            </div>
            <div className="rounded-xl border-2 border-[#8DC63F]/60 bg-[#8DC63F]/[0.08] p-4">
              <div className="text-xs text-slate-600">Catch-up a lançar no próximo IR</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-[#3B6D11]">{formatMoney(data.catchUpVsIr, "USD")}</div>
              <div className="mt-1 text-[11px] text-slate-500">MACRS acumulada − já lançado no IR</div>
            </div>
          </div>

          {data.bsAccum != null && (
            <p className="text-xs text-slate-500">
              Referência QBO — depreciação acumulada no Balance Sheet ({data.bsLabel}):{" "}
              <span className="tabular-nums text-slate-700">{formatMoney(data.bsAccum, "USD")}</span>
              {data.catchUpVsBs != null && (
                <> · diferença p/ o MACRS: <span className="tabular-nums text-slate-700">{formatMoney(data.catchUpVsBs, "USD")}</span></>
              )}
            </p>
          )}

          {/* Tabela por ano */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Ano</th>
                  <th className="px-3 py-2 text-right font-medium">MACRS (ano)</th>
                  <th className="px-3 py-2 text-right font-medium">MACRS acumulada</th>
                  <th className="px-3 py-2 text-right font-medium">IR lançado</th>
                  <th className="px-3 py-2 text-right font-medium">Diferença</th>
                  <th className="px-3 py-2 text-center font-medium">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((r) => {
                  const st = STATUS[r.status];
                  const future = r.year > data.throughYear;
                  return (
                    <tr key={r.year} className={r.status === "faltou" ? "bg-red-50/40" : future ? "text-slate-400" : ""}>
                      <td className="px-4 py-2 font-medium">{r.year}{future ? " (proj.)" : ""}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.macrs ? formatMoney(r.macrs, "USD") : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{formatMoney(r.macrsAccum, "USD")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.ir == null ? "—" : formatMoney(r.ir, "USD")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.diff == null ? "—" : formatMoney(r.diff, "USD")}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${st.cls}`}>{st.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">
            &ldquo;não lançou&rdquo; = MACRS pede depreciação mas o IR do ano não teve (ex.: ano
            esquecido). &ldquo;sem IR&rdquo; = não há retorno do ano na base. O catch-up assume os
            anos sem IR como não lançados — confira com o contador antes de deduzir tudo de uma vez
            (pode haver limite/forma própria de recuperar depreciação omitida, ex.: Form 3115).
          </p>
        </>
      )}
    </section>
  );
}
