import { formatMoney } from "@/lib/money";
import type { DepReconciliation } from "@/lib/assets/reconcile-dep";
import { DepReconcileTable, type AssetForRecon } from "./dep-reconcile-table";

export function DepReconcile({ data, assets }: { data: DepReconciliation | null; assets: AssetForRecon[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-medium text-slate-800">
          Depreciation reconciliation (by year){data ? ` — ${data.companyName}` : ""}
        </h2>
        <p className="text-sm text-slate-500">
          What MACRS says <strong>should</strong> have been depreciated each year × what was reported
          on the tax return. The <strong>real catch-up</strong> is only for the years already filed;
          closed years still without a return are <strong>normal depreciation to report</strong> (not
          arrears).
        </p>
      </div>

      {!data ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">
          This company has no registered assets — register them in the Assets tab to reconcile
          depreciation by year.
        </p>
      ) : (
        <>
          {/* Headline: separa o catch-up REAL (anos declarados) da depreciação normal a declarar. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">
                Reported on the tax return{data.lastFiledYear ? ` (thru ${data.lastFiledYear})` : " so far"}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{formatMoney(data.irToDate, "USD")}</div>
              {data.irYearsMissing.length > 0 && (
                <div className="mt-1 text-[11px] text-amber-600">no tax return in years: {data.irYearsMissing.join(", ")}</div>
              )}
            </div>
            <div className="rounded-xl border-2 border-[#8DC63F]/60 bg-[#8DC63F]/[0.08] p-4">
              <div className="text-xs text-slate-600">
                Real catch-up — years already filed{data.lastFiledYear ? ` (thru ${data.lastFiledYear})` : ""}
              </div>
              <div className={`mt-1 text-xl font-semibold tabular-nums ${data.catchUpFiled < -1 ? "text-rose-700" : "text-[#3B6D11]"}`}>
                {formatMoney(data.catchUpFiled, "USD")}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">MACRS − tax return of the filed years — what actually fell behind</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">
                To report on the next returns
                {data.lastFiledYear && data.lastFiledYear < data.throughYear
                  ? ` (${data.lastFiledYear + 1}–${data.throughYear})`
                  : ""}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{formatMoney(data.pendingToDeclare, "USD")}</div>
              <div className="mt-1 text-[11px] text-slate-500">normal depreciation of closed years not yet filed</div>
            </div>
          </div>

          {data.bsAccum != null && (
            <p className="text-xs text-slate-500">
              QBO reference — accumulated depreciation on the Balance Sheet ({data.bsLabel}):{" "}
              <span className="tabular-nums text-slate-700">{formatMoney(data.bsAccum, "USD")}</span>
              {data.catchUpVsBs != null && (
                <> · difference vs MACRS: <span className="tabular-nums text-slate-700">{formatMoney(data.catchUpVsBs, "USD")}</span></>
              )}
            </p>
          )}

          {/* Tabela por ano — linhas clicáveis abrem o detalhe por ativo (client). */}
          <DepReconcileTable rows={data.rows} throughYear={data.throughYear} assets={assets} />
        </>
      )}
    </section>
  );
}
