import { formatMoney } from "@/lib/money";
import type { DepReconciliation } from "@/lib/assets/reconcile-dep";
import { DepReconcileTable, type AssetForRecon } from "./dep-reconcile-table";

export function DepReconcile({ data, assets }: { data: DepReconciliation | null; assets: AssetForRecon[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-medium text-slate-800">
          Conferência da depreciação (por ano){data ? ` — ${data.companyName}` : ""}
        </h2>
        <p className="text-sm text-slate-500">
          O que o MACRS diz que <strong>deveria</strong> ter sido depreciado em cada ano × o que foi
          lançado no IR. Use o catch-up para alinhar o próximo IR (e o QBO) ao cálculo do app.
        </p>
      </div>

      {!data ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">
          Esta empresa não tem ativos cadastrados — cadastre na aba Ativos para conferir a
          depreciação por ano.
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

          {/* Tabela por ano — linhas clicáveis abrem o detalhe por ativo (client). */}
          <DepReconcileTable rows={data.rows} throughYear={data.throughYear} assets={assets} />
        </>
      )}
    </section>
  );
}
