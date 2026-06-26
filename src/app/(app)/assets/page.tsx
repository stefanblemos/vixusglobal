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

  // Lista só com ativos EM USO no ano: já adquiridos (entrada ≤ ano) e ainda não baixados.
  const listAssets = reg.assets.filter((a) => {
    const ay = Number(a.acquisitionDate.slice(0, 4));
    const dy = a.disposalDate ? Number(a.disposalDate.slice(0, 4)) : null;
    return ay <= year && (dy == null || dy >= year);
  });

  const usCompanies = formCompanies.filter((c) => c.jurisdiction === "US");
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

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">Ano:</span>
          <YearSelect
            years={vsIr.years}
            value={year}
            basePath="/assets"
            params={{ tab, ...(company ? { company } : {}) }}
          />
        </div>
        <form action="/assets" className="flex items-center gap-2">
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="tab" value={tab} />
          <select name="company" defaultValue={company ?? ""} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
            <option value="">Todas as empresas</option>
            {usCompanies.map((c) => {
              const hasAssets = assetCompanies.some((a) => a.id === c.id);
              return (
                <option key={c.id} value={c.id}>
                  {c.legalName}{hasAssets ? "" : " (sem ativos)"}
                </option>
              );
            })}
          </select>
          <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-100">Ver</button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label={`Depreciation ${year}`} value={formatMoney(reg.totalYearDep, "USD")} />
        <Stat label={`Ativos em uso (${year})`} value={String(listAssets.length)} />
        <Stat label="Companies with assets" value={String(reg.byCompany.length)} />
      </div>

      {/* Abas */}
      <div className="flex gap-1 border-b border-slate-200 text-sm">
        {([["ativos", "Ativos"], ["conferencia", "Conferência"], ...(hasPt ? [["portugal", "Portugal"]] : [])] as [string, string][]).map(([key, label]) => (
          <Link
            key={key}
            href={`/assets?tab=${key}&year=${year}`}
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
          <h2 className="text-lg font-medium text-slate-800">Computed vs tax return (acumulado) — até {year}</h2>
          <p className="text-sm text-slate-500">
            A MACRS <strong>acumulada</strong> calculada contra a depreciação <strong>acumulada</strong>{" "}
            lançada no IR (Form 4562). A diferença é o <strong>catch-up</strong> — o mesmo número da
            conferência por ano abaixo (não a diferença de um ano só, que engana quando o contador
            lança um catch-up de uma vez).
          </p>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 text-right font-medium">Computed acum. (MACRS)</th>
                  <th className="px-3 py-2 text-right font-medium">IR acum.</th>
                  <th className="px-3 py-2 text-right font-medium">Catch-up</th>
                  <th className="px-3 py-2 text-center font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vsRows.map((r) => (
                  <tr key={r.companyId} className={!r.ok ? "bg-rose-50/40" : ""}>
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
                        <span className="text-xs text-amber-600">no IR figure</span>
                      ) : (
                        formatMoney(r.reportedAccum, "USD")
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        Math.abs(r.catchUp) <= 1 ? "text-slate-400" : "font-medium text-amber-700"
                      }`}
                    >
                      {formatMoney(r.catchUp, "USD")}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.ok ? <span className="text-green-600">✓</span> : <span className="text-rose-500">✗</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">
            ✓ alinhado (catch-up dentro de 1%). <strong>Catch-up</strong> = MACRS acumulada − IR
            acumulado (o que, no total, ainda falta lançar até {year}). &ldquo;no IR figure&rdquo; =
            nenhum IR com linha de depreciação até {year} — conta como não lançado.
          </p>
        </section>
      )}

      {tab === "ativos" && (
        <>
          {listAssets.length === 0 && reg.assets.length > 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
              Nenhum ativo em uso em {year} — os {reg.assets.length} ativos cadastrados entraram em
              serviço depois. Selecione um ano a partir da aquisição.
            </div>
          ) : (
            <AssetTimeline assets={listAssets} year={year} />
          )}
          <p className="text-xs text-slate-400">
            MACRS GDS half-year tables (Pub. 946); real property is straight-line mid-month. §179 and
            bonus are taken in year 1, then MACRS on the remaining basis. A control estimate — confirm
            conventions (mid-quarter, luxury-auto caps) with the accountant.
          </p>
        </>
      )}

      {tab === "conferencia" && (
        company ? (
          <DepReconcile data={reconData} />
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            Selecione uma empresa no seletor acima para ver a conferência da depreciação ano a ano
            (MACRS × IR) e o catch-up.
          </p>
        )
      )}

      {tab === "portugal" && ptReg.companies.length > 0 && (
        <section className="space-y-3 border-t border-slate-200 pt-6">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Portugal — depreciação</h2>
            <p className="text-sm text-slate-500">
              Método das quotas constantes (Decreto Regulamentar 25/2009) — taxa anual fixa, na moeda
              nativa da empresa. O terreno não deprecia; benfeitorias e IMT entram no custo.
            </p>
          </div>

          {ptReg.byCompany.length > 0 ? (
            <>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Empresa</th>
                      <th className="px-4 py-2 text-right font-medium">Depreciação {year}</th>
                      <th className="px-4 py-2 text-right font-medium">Acumulada até {year}</th>
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
                      <th className="px-3 py-2 font-medium">Ativo</th>
                      <th className="px-3 py-2 font-medium">Empresa</th>
                      <th className="px-3 py-2 font-medium">Tipo</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">Entrada</th>
                      <th className="px-3 py-2 text-right font-medium">Custo</th>
                      <th className="px-3 py-2 text-right font-medium">Terreno</th>
                      <th className="px-3 py-2 text-right font-medium">Base</th>
                      <th className="px-3 py-2 text-right font-medium">Dep {year}</th>
                      <th className="px-3 py-2 text-right font-medium">Acum.</th>
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
                          <span className="text-slate-400"> · {a.ratePct}%/ano</span>
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
              Nenhum ativo PT cadastrado. Selecione uma empresa de Portugal no formulário acima para
              cadastrar (ex.: imóvel) — depreciação por quotas constantes.
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
