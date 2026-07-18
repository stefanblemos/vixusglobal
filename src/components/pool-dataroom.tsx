import { formatMoney } from "@/lib/money";
import { deletePoolDocument, toggleDocPortalVisible } from "@/lib/actions/pool-docs";
import { tOf, type Lang } from "@/lib/pools/i18n";
import { UploadPoolDocForm } from "@/components/pool-dataroom-forms";

// Data room do pool (Fase 3, mock aprovado 18/07): docs agrupados (loans automáticos +
// upload por categoria) com toggle Interno|Portal, e o bloco Taxas & partes relacionadas.
// Bilíngue EN|PT (seletor); DATAS seguem o locale do navegador/Windows (prop dateLocale).

export type LoanDocRow = {
  id: string;
  fileName: string;
  kind: string;
  createdAt: Date;
  bank: string;
  portalVisible: boolean;
};
export type PoolDocRow = {
  id: string;
  docType: string;
  fileName: string;
  createdAt: Date;
  portalVisible: boolean;
  hasPdf: boolean;
  memberName?: string | null; // doc pessoal (K-1 etc.) — só o sócio vê no portal
};
export type FeesData = {
  perfPct: number | null; // fração do lucro dos INVESTIDORES (cadastro do pool)
  perfTiming: string | null;
  perfFeeTotal: number | null; // da simulação de origem (plano)
  contractorFeeTotal: number | null;
  promoteTotal: number | null;
  vehicleCostTotal: number | null;
  builderName: string;
  housesCount: number;
  hasNote: boolean;
  banks: string[];
};

const CORPORATE_TYPES = ["OPERATING_AGREEMENT", "SUBSCRIPTION", "NOTE", "NOVATION", "CAP_TABLE"];
const REPORT_TYPES = ["STATEMENT", "DISTRIBUTION_STMT", "CLOSING_STMT"];

const th = "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400";
const thR = "px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400";
const td = "px-3 py-1.5 text-sm text-slate-600";

function VisToggle({ table, docId, visible, t }: { table: "pool" | "loan"; docId: string; visible: boolean; t: ReturnType<typeof tOf> }) {
  return (
    <form action={toggleDocPortalVisible} className="inline-flex">
      <input type="hidden" name="docId" value={docId} />
      <input type="hidden" name="table" value={table} />
      <button
        type="submit"
        title={t("dr.c.visibility")}
        className="flex overflow-hidden rounded-full border border-slate-200 text-[9.5px] font-bold"
      >
        <span className={visible ? "px-2 py-0.5 text-slate-400" : "bg-slate-500 px-2 py-0.5 text-white"}>
          {t("dr.internal")}
        </span>
        <span className={visible ? "bg-emerald-600 px-2 py-0.5 text-white" : "px-2 py-0.5 text-slate-400"}>
          {t("dr.portal")}
        </span>
      </button>
    </form>
  );
}

function GroupHead({ label }: { label: string }) {
  return (
    <div className="mt-4 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 first:mt-0">
      {label}
    </div>
  );
}

export function PoolDataRoom({
  poolId,
  lang,
  dateLocale,
  currency,
  loanDocs,
  poolDocs,
  fees,
  memberOptions = [],
}: {
  poolId: string;
  lang: Lang;
  dateLocale: string;
  currency: string;
  loanDocs: LoanDocRow[];
  poolDocs: PoolDocRow[];
  fees: FeesData;
  memberOptions?: Array<{ id: string; name: string }>;
}) {
  const t = tOf(lang);
  const fmtDate = (d: Date) => {
    try {
      return new Intl.DateTimeFormat(dateLocale, { timeZone: "UTC" }).format(d);
    } catch {
      return d.toISOString().slice(0, 10);
    }
  };
  const compact = (v: number) => {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(v);
    } catch {
      return formatMoney(v, currency);
    }
  };
  const corporate = poolDocs.filter((d) => CORPORATE_TYPES.includes(d.docType));
  const reports = poolDocs.filter((d) => REPORT_TYPES.includes(d.docType));
  const others = poolDocs.filter((d) => !CORPORATE_TYPES.includes(d.docType) && !REPORT_TYPES.includes(d.docType));
  const hasOA = corporate.some((d) => d.docType === "OPERATING_AGREEMENT");

  const PoolDocRows = ({ docs }: { docs: PoolDocRow[] }) => (
    <>
      {docs.map((d) => (
        <tr key={d.id} className="border-b border-slate-50">
          <td className={td}>
            {d.hasPdf ? (
              <a
                href={`/api/pool-docs/${d.id}/pdf`}
                target="_blank"
                className="text-[#1f3a5f] hover:underline"
              >
                {d.fileName}
              </a>
            ) : (
              d.fileName
            )}
          </td>
          <td className={td}>—</td>
          <td className={td}>
            <span className="rounded-full bg-[#e8eef7] px-2 py-0.5 text-[10px] font-bold text-[#1f3a5f]">
              {d.docType.replace(/_/g, " ")}
            </span>
            {d.memberName && (
              <span className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                👤 {d.memberName.split(" ")[0]}
              </span>
            )}
          </td>
          <td className={`${td} tabular-nums`}>{fmtDate(d.createdAt)}</td>
          <td className="px-3 py-1.5 text-right">
            <VisToggle table="pool" docId={d.id} visible={d.portalVisible} t={t} />
            <form action={deletePoolDocument} className="ml-2 inline">
              <input type="hidden" name="docId" value={d.id} />
              <button type="submit" className="text-xs text-slate-300 hover:text-red-500" title="✕">
                ✕
              </button>
            </form>
          </td>
        </tr>
      ))}
    </>
  );

  return (
    <div className="space-y-4">
      {/* ── Documentos do pool ── */}
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
            {t("dr.title")}
          </h2>
          <details className="relative">
            <summary className="inline-block cursor-pointer rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
              {t("dr.add")}
            </summary>
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <UploadPoolDocForm poolId={poolId} lang={lang} memberOptions={memberOptions} />
            </div>
          </details>
        </div>
        <p className="mt-0.5 text-xs text-slate-400">{t("dr.desc")}</p>

        <GroupHead label={t("dr.g.financing")} />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th}>{t("dr.c.document")}</th>
                <th className={th}>{t("dr.c.source")}</th>
                <th className={th}>{t("dr.c.type")}</th>
                <th className={th}>{t("dr.c.readOn")}</th>
                <th className={thR}>{t("dr.c.visibility")}</th>
              </tr>
            </thead>
            <tbody>
              {loanDocs.map((d) => (
                <tr key={d.id} className="border-b border-slate-50">
                  <td className={td}>
                    <a
                      href={`/api/loan-docs/${d.id}/pdf`}
                      target="_blank"
                      className="text-[#1f3a5f] hover:underline"
                    >
                      {d.fileName}
                    </a>
                  </td>
                  <td className={td}>{d.bank}</td>
                  <td className={td}>
                    <span className="rounded-full bg-[#e8eef7] px-2 py-0.5 text-[10px] font-bold text-[#1f3a5f]">
                      {d.kind}
                    </span>
                  </td>
                  <td className={`${td} tabular-nums`}>{fmtDate(d.createdAt)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <VisToggle table="loan" docId={d.id} visible={d.portalVisible} t={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <GroupHead label={t("dr.g.corporate")} />
        <div className="overflow-x-auto">
          <table className="w-full">
            <tbody>
              {!hasOA && (
                <tr className="border-b border-slate-50">
                  <td className={td}>Operating Agreement</td>
                  <td className={td}>—</td>
                  <td className={td}>
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                      {t("dr.oa.pending")}
                    </span>
                  </td>
                  <td className={td} />
                  <td className="px-3 py-1.5 text-right text-[10.5px] text-slate-400">{t("dr.oa.lands")}</td>
                </tr>
              )}
              <PoolDocRows docs={corporate} />
              {corporate.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-2 text-[11px] text-slate-400">
                    {t("dr.corporate.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <GroupHead label={t("dr.g.reports")} />
        <div className="overflow-x-auto">
          <table className="w-full">
            <tbody>
              <PoolDocRows docs={reports} />
              {reports.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-2 text-[11px] text-slate-400">
                    {t("dr.reports.auto")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {others.length > 0 && (
          <>
            <GroupHead label={t("dr.g.other")} />
            <div className="overflow-x-auto">
              <table className="w-full">
                <tbody>
                  <PoolDocRows docs={others} />
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* ── Taxas & partes relacionadas ── */}
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
          {t("fees.title")}
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">{t("fees.desc")}</p>
        <div className="mt-2.5 space-y-1 text-xs text-slate-600">
          <div className="flex justify-between gap-4">
            <span>{t("fees.perf")}</span>
            <b className="text-right">
              {fees.perfPct == null
                ? t("fees.perf.none")
                : `${Math.round((1 - fees.perfPct) * 100)}% ${t("fees.perf.ofProfit")}` +
                  (fees.perfTiming === "PER_SALE" || fees.perfTiming === "PROJECT_COMPLETION"
                    ? ` · ${t(`fees.timing.${fees.perfTiming}` as "fees.timing.PER_SALE")}`
                    : "") +
                  (fees.perfFeeTotal && fees.perfFeeTotal > 0
                    ? ` · ≈ ${compact(fees.perfFeeTotal)} (${t("fees.plan")})`
                    : "")}
            </b>
          </div>
          <div className="flex justify-between gap-4">
            <span>{t("fees.contractor")}</span>
            <b className="text-right">
              {fees.contractorFeeTotal && fees.contractorFeeTotal > 0
                ? `≈ ${compact(fees.contractorFeeTotal)} (${t("fees.plan")}) — ${t("fees.contractor.embedded")}`
                : t("fees.contractor.embedded")}
            </b>
          </div>
          {fees.promoteTotal != null && fees.promoteTotal > 0 && (
            <div className="flex justify-between gap-4">
              <span>{t("fees.promote")}</span>
              <b className="text-right">
                ≈ {compact(fees.promoteTotal)} ({t("fees.plan")})
              </b>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <span>{t("fees.vehicle")}</span>
            <b className="text-right">
              {fees.vehicleCostTotal && fees.vehicleCostTotal > 0
                ? `≈ ${compact(fees.vehicleCostTotal)} (${t("fees.plan")})`
                : t("fees.vehicle.waived")}
            </b>
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th}>{t("fees.c.party")}</th>
                <th className={th}>{t("fees.c.role")}</th>
                <th className={th}>{t("fees.c.rel")}</th>
                <th className={th}>{t("fees.c.where")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-50">
                <td className={td}>{fees.builderName}</td>
                <td className={td}>{t("fees.builder.role", { n: fees.housesCount })}</td>
                <td className={td}>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                    {t("fees.related")}
                  </span>
                </td>
                <td className={td}>{t("fees.builder.where")}</td>
              </tr>
              <tr className="border-b border-slate-50">
                <td className={td}>Vixus Global</td>
                <td className={td}>{t("fees.sponsor.role")}</td>
                <td className={td}>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                    {t("fees.related")}
                  </span>
                </td>
                <td className={td}>
                  {fees.hasNote
                    ? t("fees.sponsor.where.note")
                    : fees.vehicleCostTotal && fees.vehicleCostTotal > 0
                      ? t("fees.sponsor.where.vehicle")
                      : t("fees.sponsor.where.waived")}
                </td>
              </tr>
              {fees.banks.length > 0 && (
                <tr className="border-b border-slate-50">
                  <td className={td}>{fees.banks.join(" · ")}</td>
                  <td className={td}>{t("fees.lenders.role")}</td>
                  <td className={td}>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                      {t("fees.independent")}
                    </span>
                  </td>
                  <td className={td}>{t("fees.lenders.where")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10.5px] text-slate-400">{t("fees.source")}</p>
      </section>
    </div>
  );
}
