import Link from "next/link";
import { buildAssetRegister } from "@/lib/assets/depreciation";
import { buildPtAssetRegister } from "@/lib/assets/pt-register";
import { buildDepreciationVsIR } from "@/lib/assets/dep-vs-ir";
import { detectAssetsFromQbo } from "@/lib/assets/detect";
import { buildDepreciationReconciliation } from "@/lib/assets/reconcile-dep";
import { DepReconcile } from "@/components/dep-reconcile";
import { AssetActions } from "@/components/asset-actions";
import { AssetTimeline } from "@/components/asset-timeline";
import { YearSelect } from "@/components/year-select";
import { CompanySelect } from "@/components/company-select";
import { deleteAsset } from "@/lib/actions/assets";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; company?: string; detect?: string; recon?: string; tab?: string }>;
}) {
  const { year: yearParam, company, detect, recon, tab: tabParam } = await searchParams;
  const currentYear = new Date().getUTCFullYear();
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : currentYear;

  const detected = detect ? await detectAssetsFromQbo(detect) : null;

  const [reg, ptReg, vsIr, formCompanies] = await Promise.all([
    buildAssetRegister(year, company),
    buildPtAssetRegister(year, company),
    buildDepreciationVsIR(year),
    prisma.company.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, legalName: true, jurisdiction: true, baseCurrency: true },
      orderBy: { legalName: "asc" },
    }),
  ]);

  // Conferência da depreciação por ano: segue a empresa do select global (company). Só quando uma
  // empresa está selecionada — em "Todas" mostramos a visão agregada.
  const reconData = company ? await buildDepreciationReconciliation(company) : null;
  // Registro com MACRS PURA (deveria) — para o "Deveria (MACRS)" da conferência (regra legal do IRS,
  // não o valor acelerado do livro) e para o comparativo estimado×real do modal do ativo. O efetivo
  // (reg) é usado para o "Depreciado (livro)" derivado. Construído p/ TODOS os ativos da visão.
  const regPure = await buildAssetRegister(year, company, { pureMacrs: true });
  const pureScheduleById = new Map(regPure.assets.map((a) => [a.id, a.schedule]));
  // Depreciação real registrada (AssetYearDepreciation) por ano — p/ a conferência E o modal do ativo.
  const actualRows = await prisma.assetYearDepreciation.findMany({
    where: { assetId: { in: reg.assets.map((a) => a.id) } },
    select: { assetId: true, year: true, amount: true },
  });
  const actualByAsset = new Map<string, Record<string, number>>();
  for (const r of actualRows) {
    const mp = actualByAsset.get(r.assetId) ?? {};
    mp[String(r.year)] = Number(r.amount.toString());
    actualByAsset.set(r.assetId, mp);
  }
  const reconAssets = company
    ? reg.assets.map((a) => {
        // "Depreciado (livro)" derivado dos sinais já cadastrados: se o ativo foi marcado
        // "totalmente depreciado no livro" ou "baixado", o schedule efetivo (a.schedule) JÁ
        // reflete o que o livro fez → vira a fonte do depreciado por ano. Entrada manual sobrescreve.
        const hasBookSignal = a.fullyDepreciatedYear != null || a.disposalDate != null;
        const dispY = a.disposalDate ? Number(a.disposalDate.slice(0, 4)) : null;
        const derivedByYear: Record<string, number> = {};
        // Deriva o livro a partir do cadastro (totalmente dep./baixa). EXCEÇÃO: o ANO DA BAIXA não é
        // assumido — a meia-cota é só a regra ("deveria"); o contador pode não tê-la tomado. Fica "—"
        // (não registrado) para o usuário confirmar o que de fato foi lançado (0 ou o valor real).
        if (hasBookSignal)
          for (const s of a.schedule) {
            if (s.year === dispY) continue;
            derivedByYear[String(s.year)] = s.amount;
          }
        return {
          id: a.id,
          name: a.name,
          cost: a.cost,
          disposalYear: a.disposalDate ? Number(a.disposalDate.slice(0, 4)) : null,
          // "Deveria" = MACRS pura; "derivado" = efetivo (a.schedule, com totalmente dep./baixa).
          macrsSchedule: pureScheduleById.get(a.id) ?? a.schedule,
          actualByYear: actualByAsset.get(a.id) ?? {},
          derivedByYear,
        };
      })
    : [];
  // "Computed vs tax return" (acumulado): filtra para a empresa selecionada, se houver.
  const vsRows = company ? vsIr.rows.filter((r) => r.companyId === company) : vsIr.rows;

  // Empresas que têm ativos (para o select "Todas / por empresa").
  const assetCoIds = (
    await prisma.fixedAsset.findMany({ where: { regime: "US" }, distinct: ["companyId"], select: { companyId: true } })
  ).map((r) => r.companyId);
  const assetCompanies = await prisma.company.findMany({
    where: { id: { in: assetCoIds } },
    select: { id: true, legalName: true },
    orderBy: { legalName: "asc" },
  });

  // A aba "Ativos" é o REGISTRO: mostra TODOS os ativos cadastrados (o ano dirige as colunas e as
  // tags). Assim um ativo recém-criado com entrada futura ao ano selecionado não some da lista.
  const listAssets = reg.assets;
  // Contagem "em uso no ano" (para o card): já adquiridos (entrada ≤ ano) e ainda não baixados.
  const inUseCount = reg.assets.filter((a) => {
    const ay = Number(a.acquisitionDate.slice(0, 4));
    const dy = a.disposalDate ? Number(a.disposalDate.slice(0, 4)) : null;
    return ay <= year && (dy == null || dy >= year);
  }).length;

  const usCompanies = formCompanies.filter((c) => c.jurisdiction === "US");
  // Opções do seletor de empresa: todas as US, marcando as que não têm ativos.
  const companyOptions = [
    { value: "", label: "All companies" },
    ...usCompanies.map((c) => ({
      value: c.id,
      label: c.legalName + (assetCompanies.some((a) => a.id === c.id) ? "" : " (no assets)"),
    })),
  ];
  const hasPt = ptReg.companies.length > 0;
  const TABS = ["ativos", "conferencia", "portugal"] as const;
  const tab: (typeof TABS)[number] =
    tabParam && (TABS as readonly string[]).includes(tabParam)
      ? (tabParam as (typeof TABS)[number])
      : recon
        ? "conferencia"
        : "ativos";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Fixed assets &amp; depreciation</h1>
        <p className="text-sm text-slate-500">
          MACRS depreciation per asset (US) from the acquisition date — with §179 and bonus. The
          computed accumulated depreciation is the basis to compare against the tax return.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">Year:</span>
          <YearSelect
            years={vsIr.years}
            value={year}
            basePath="/assets"
            params={{ tab, ...(company ? { company } : {}) }}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-400">Company:</span>
          <CompanySelect
            options={companyOptions}
            value={company ?? ""}
            basePath="/assets"
            params={{ tab, year: String(year) }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label={`Depreciation ${year}`} value={formatMoney(reg.totalYearDep, "USD")} />
        <Stat label={`Assets in use (${year})`} value={String(inUseCount)} />
        <Stat label="Companies with assets" value={String(reg.byCompany.length)} />
      </div>

      {/* Abas */}
      <div className="flex gap-1 border-b border-slate-200 text-sm">
        {([["ativos", "Assets"], ["conferencia", "Reconciliation"], ...(hasPt ? [["portugal", "Portugal"]] : [])] as [string, string][]).map(([key, label]) => (
          <Link
            key={key}
            href={`/assets?tab=${key}&year=${year}${company ? `&company=${company}` : ""}`}
            className={`-mb-px border-b-2 px-4 py-2 ${
              tab === key ? "border-[#1f3a5f] font-medium text-[#1f3a5f]" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* Aba Ativos — ações + lista */}
      {tab === "ativos" && (
        <AssetActions
          key={detect ?? "none"}
          formCompanies={formCompanies}
          usCompanies={usCompanies}
          detected={detected}
          detectCompanyId={detect ?? ""}
          hasAssets={reg.assets.length > 0}
        />
      )}

      {/* Visão agregada (só em "Todas as empresas") — fica sem sentido com 1 empresa selecionada. */}
      {tab === "conferencia" && !company && reg.byCompany.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 text-right font-medium">Depreciation {year}</th>
                <th className="px-4 py-2 text-right font-medium">Accumulated thru {year}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reg.byCompany.map((c) => (
                <tr key={c.companyId}>
                  <td className="px-4 py-2 font-medium text-slate-700">{c.companyName}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                    {formatMoney(c.yearDep, "USD")}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                    {formatMoney(c.accumulated, "USD")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "conferencia" && vsRows.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium text-slate-800">Computed vs tax return (accumulated)</h2>
          <p className="text-sm text-slate-500">
            The <strong>accumulated</strong> MACRS against the <strong>accumulated</strong> depreciation
            reported on the tax return (Form 4562), measured <strong>up to the last filed return</strong>{" "}
            of each company — later years not yet filed don&apos;t count (otherwise the difference
            inflates by comparing a projection against a frozen return). The difference is the{" "}
            <strong>real catch-up</strong> — the same number as the year-by-year reconciliation below.
          </p>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 text-right font-medium">Computed accum. (MACRS)</th>
                  <th className="px-3 py-2 text-right font-medium">Tax return accum.</th>
                  <th className="px-3 py-2 text-right font-medium">Catch-up</th>
                  <th className="px-3 py-2 text-center font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vsRows.map((r) => (
                  <tr
                    key={r.companyId}
                    className={r.irWithoutAssets ? "bg-amber-50/40" : !r.ok ? "bg-rose-50/40" : ""}
                  >
                    <td className="px-4 py-2">
                      <Link href={`/companies/${r.companyId}`} className="font-medium text-[#1f3a5f] hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {formatMoney(r.accumulated, "USD")}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {r.reportedAccum == null ? (
                        <span className="text-xs text-amber-600">no tax return figure</span>
                      ) : (
                        formatMoney(r.reportedAccum, "USD")
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        r.irWithoutAssets
                          ? "text-amber-700"
                          : Math.abs(r.catchUp) <= 1
                            ? "text-slate-400"
                            : "font-medium text-amber-700"
                      }`}
                    >
                      {r.irWithoutAssets ? (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                          tax return with no registered assets
                        </span>
                      ) : (
                        formatMoney(r.catchUp, "USD")
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.irWithoutAssets ? (
                        <span title="The tax return has depreciation but no assets are registered — register the assets. Reconciliation shows 0 (nothing to reconcile)." className="text-amber-600">⚠</span>
                      ) : r.ok ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-rose-500">✗</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">
            ✓ aligned (catch-up within 1%). <strong>Catch-up</strong> = accumulated MACRS − accumulated
            tax return, <strong>up to the last filed return</strong> of each company (what, in total,
            still needs to be reported from the years already filed). &ldquo;no tax return figure&rdquo;
            = company with no tax return that has a depreciation line — counts as not reported.
          </p>
        </section>
      )}

      {tab === "ativos" && (
        <>
          <AssetTimeline
            assets={listAssets}
            year={year}
            actualByAsset={Object.fromEntries(actualByAsset)}
            pureScheduleById={Object.fromEntries(pureScheduleById)}
            allAssets={reg.assets.map((a) => ({
              id: a.id,
              companyId: a.companyId,
              name: a.name,
              cost: a.cost,
              acquisitionDate: a.acquisitionDate,
              method: a.method,
              recoveryYears: a.recoveryYears,
            }))}
          />
          <p className="text-xs text-slate-400">
            MACRS GDS half-year tables (Pub. 946); real property is straight-line mid-month. §179 and
            bonus are taken in year 1, then MACRS on the remaining basis. A control estimate — confirm
            conventions (mid-quarter, luxury-auto caps) with the accountant.
          </p>
        </>
      )}

      {tab === "conferencia" && (
        company ? (
          <DepReconcile data={reconData} assets={reconAssets} />
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            Select a company in the selector above to see the year-by-year depreciation reconciliation
            (MACRS × tax return) and the catch-up.
          </p>
        )
      )}

      {tab === "portugal" && ptReg.companies.length > 0 && (
        <section className="space-y-3 border-t border-slate-200 pt-6">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Portugal — depreciation</h2>
            <p className="text-sm text-slate-500">
              Straight-line method (Decreto Regulamentar 25/2009) — fixed annual rate, in the
              company&apos;s native currency. Land does not depreciate; improvements and IMT go into the
              cost.
            </p>
          </div>

          {ptReg.byCompany.length > 0 ? (
            <>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Company</th>
                      <th className="px-4 py-2 text-right font-medium">Depreciation {year}</th>
                      <th className="px-4 py-2 text-right font-medium">Accumulated thru {year}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ptReg.byCompany.map((c) => (
                      <tr key={c.companyId}>
                        <td className="px-4 py-2 font-medium text-slate-700">{c.companyName}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                          {formatMoney(c.yearDep, c.currency)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                          {formatMoney(c.accumulated, c.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Asset</th>
                      <th className="px-3 py-2 font-medium">Company</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">In service</th>
                      <th className="px-3 py-2 text-right font-medium">Cost</th>
                      <th className="px-3 py-2 text-right font-medium">Land</th>
                      <th className="px-3 py-2 text-right font-medium">Base</th>
                      <th className="px-3 py-2 text-right font-medium">Dep {year}</th>
                      <th className="px-3 py-2 text-right font-medium">Accum.</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ptReg.assets.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-700">{a.name}</td>
                        <td className="px-3 py-2 text-slate-600">{a.companyName}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {a.categoryLabel}
                          <span className="text-slate-400"> · {a.ratePct}%/year</span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                          {a.acquisitionDate}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {formatMoney(a.cost, a.currency)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                          {a.landValue > 0 ? formatMoney(a.landValue, a.currency) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                          {formatMoney(a.depreciableBasis, a.currency)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">
                          {formatMoney(a.yearDep, a.currency)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                          {formatMoney(a.accumulated, a.currency)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <form action={deleteAsset}>
                            <input type="hidden" name="id" value={a.id} />
                            <button className="text-xs text-slate-300 hover:text-red-600" title="Delete">
                              ✕
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">
              No PT assets registered. Select a Portugal company in the form above to register one
              (e.g. real estate) — straight-line depreciation.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-800">{value}</div>
    </div>
  );
}
