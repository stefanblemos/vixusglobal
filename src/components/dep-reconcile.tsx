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
          lançado no IR. O <strong>catch-up real</strong> é só dos anos já declarados; anos fechados
          ainda sem IR são depreciação <strong>normal a declarar</strong> (não atraso).
        </p>
      </div>

      {!data ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">
          Esta empresa não tem ativos cadastrados — cadastre na aba Ativos para conferir a
          depreciação por ano.
        </p>
      ) : (
        <>
          {/* Headline: separa o catch-up REAL (anos declarados) da depreciação normal a declarar. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">
                Lançado no IR{data.lastFiledYear ? ` (até ${data.lastFiledYear})` : " até agora"}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{formatMoney(data.irToDate, "USD")}</div>
              {data.irYearsMissing.length > 0 && (
                <div className="mt-1 text-[11px] text-amber-600">sem IR nos anos: {data.irYearsMissing.join(", ")}</div>
              )}
            </div>
            <div className="rounded-xl border-2 border-[#8DC63F]/60 bg-[#8DC63F]/[0.08] p-4">
              <div className="text-xs text-slate-600">
                Catch-up real — anos já declarados{data.lastFiledYear ? ` (até ${data.lastFiledYear})` : ""}
              </div>
              <div className={`mt-1 text-xl font-semibold tabular-nums ${data.catchUpFiled < -1 ? "text-rose-700" : "text-[#3B6D11]"}`}>
                {formatMoney(data.catchUpFiled, "USD")}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">MACRS − IR dos anos declarados — o que de fato ficou para trás</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">
                A declarar nos próximos IRs
                {data.lastFiledYear && data.lastFiledYear < data.throughYear
                  ? ` (${data.lastFiledYear + 1}–${data.throughYear})`
                  : ""}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{formatMoney(data.pendingToDeclare, "USD")}</div>
              <div className="mt-1 text-[11px] text-slate-500">depreciação normal de anos fechados ainda não declarados</div>
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
