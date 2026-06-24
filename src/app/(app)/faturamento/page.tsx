import { prisma } from "@/lib/db";
import { buildFaturamento, type Block, type PeriodFig } from "@/lib/reports/faturamento";

export const dynamic = "force-dynamic";

const MES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MES_PT[m - 1]}/${y}`;
};

export default async function FaturamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; month?: string }>;
}) {
  const { company: companyParam, month } = await searchParams;

  // Empresas que têm GL (a fonte do relatório).
  const withGl = await prisma.ledgerTxn.findMany({ distinct: ["companyId"], select: { companyId: true } });
  const ids = withGl.map((r) => r.companyId);
  const companies = await prisma.company.findMany({
    where: { id: { in: ids } },
    select: { id: true, legalName: true },
    orderBy: { legalName: "asc" },
  });

  const companyId = companyParam && ids.includes(companyParam) ? companyParam : companies[0]?.id;
  const data = companyId ? await buildFaturamento(companyId, month) : null;

  const fmt = (n: number, currency: string) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Faturamento × Lucro</h1>
        <p className="text-sm text-slate-500">
          Comparativo de faturamento (receita), lucro e margem por período, derivado do General
          Ledger. Escolha a empresa e o mês de referência — os blocos comparam com o mês anterior, o
          mesmo mês do ano passado e a janela de 12 meses.
        </p>
      </div>

      {/* Seletores (form GET — sem JS) */}
      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Empresa</span>
          <select name="company" defaultValue={companyId ?? ""} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.legalName}</option>
            ))}
          </select>
        </label>
        {data && data.months.length > 0 && (
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Mês de referência</span>
            <select name="month" defaultValue={data.refMonth} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {data.months.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </label>
        )}
        <button className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]">
          Ver
        </button>
      </form>

      {!data || data.months.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          {companies.length === 0
            ? "Nenhuma empresa com General Ledger importado ainda."
            : "Esta empresa não tem General Ledger importado — suba o GL em Documents para ver o faturamento por mês."}
        </div>
      ) : (
        <>
          {!data.canComputeNet && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-medium">Lucro indisponível para esta empresa.</span> Há GL, mas
              sem P&L nem Balance Sheet importado — e o lucro precisa de um deles para separar despesas
              de contas de balanço (ativos, empréstimos, intercompany) com segurança. O{" "}
              <strong>faturamento abaixo já vem do GL</strong>; importe o P&L ou o BS em Documents
              para liberar o lucro.
            </div>
          )}
          {data.canComputeNet && !data.coverage.hasPnl && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-medium">Sem P&L importado — receita e lucro podem não bater com o QBO.</span>{" "}
              Sem o P&L, a receita é identificada pelo nome da conta (Sales/Income), então contas de
              receita com outro nome (ex.: <strong>Services</strong>) ou contra-receita (ex.:{" "}
              <strong>Discounts given</strong>) ficam de fora — e ainda entram como despesa, reduzindo
              o lucro. <strong>Importe o P&L</strong> (anual serve) em Documents para a classificação
              ficar igual à do QBO.
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {data.blocks.map((b) => (
              <BlockCard key={b.key} b={b} currency={data.currency} fmt={fmt} />
            ))}
          </div>

          {/* Painel de conferência — para confiar nos números */}
          <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <summary className="cursor-pointer font-medium text-slate-700">
              Conferência dos dados ({Math.round(data.coverage.classifiedPct * 100)}% do movimento classificado)
            </summary>
            <div className="mt-3 space-y-2 text-slate-600">
              <p>
                <span className="text-slate-400">GL cobre:</span> {monthLabel(data.coverage.glSpan.min ?? "")} —{" "}
                {monthLabel(data.coverage.glSpan.max ?? "")}.{" "}
                <span className="text-slate-400">Base do lucro:</span>{" "}
                {data.coverage.netBasis === "nenhum" ? (
                  <span className="text-amber-700">nenhuma (importe P&L ou BS) — só faturamento.</span>
                ) : (
                  <span>{data.coverage.netBasis}.</span>
                )}
              </p>
              {data.coverage.missingMonths.length > 0 && (
                <p className="text-amber-700">
                  ⚠ Faltam meses no GL para o comparativo completo: {data.coverage.missingMonths.map(monthLabel).join(", ")}.
                  Os períodos afetados ficam parciais.
                </p>
              )}
              <p>
                <span className="text-slate-400">Contas de receita usadas:</span>{" "}
                {data.coverage.incomeAccounts.length ? data.coverage.incomeAccounts.join(", ") : "—"}
              </p>
              {data.coverage.unknownAccounts.length > 0 && (
                <div>
                  <span className="text-slate-400">Contas fora do P&L/BS (assumidas como despesa — confira se alguma é, na verdade, balanço ou receita):</span>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {data.coverage.unknownAccounts.map((u) => (
                      <li key={u.account} className="tabular-nums">
                        {u.account} · {fmt(u.amount, data.currency)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-slate-400">
                O faturamento sai das contas de receita (preciso). O lucro = receita − despesas
                classificadas; confira contra o P&L do QBO do mesmo período se houver divergência.
              </p>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function pctText(v: number | null) {
  if (v == null) return "—";
  const s = (v * 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${v > 0 ? "+" : ""}${s}%`;
}
function pctColor(v: number | null) {
  if (v == null) return "text-slate-400";
  return v >= 0 ? "text-emerald-600" : "text-red-600";
}

function BlockCard({
  b,
  currency,
  fmt,
}: {
  b: Block;
  currency: string;
  fmt: (n: number, c: string) => string;
}) {
  const cell = (f: PeriodFig | null) =>
    f ? (
      <div className="text-right">
        <div className="font-semibold tabular-nums text-slate-800">{fmt(f.income, currency)}</div>
        <div className="text-xs tabular-nums text-slate-500">
          {f.net == null
            ? "Lucro —"
            : `Lucro ${fmt(f.net, currency)} · ${f.margin == null ? "—" : `${(f.margin * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`}`}
        </div>
      </div>
    ) : (
      <div className="text-right text-slate-300">—</div>
    );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 text-sm font-medium text-slate-700">{b.title}</div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">{b.current.label}</span>
          {cell(b.current)}
        </div>
        {b.compare && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
            <span className="text-xs text-slate-500">{b.compare.label}</span>
            {cell(b.compare)}
          </div>
        )}
      </div>
      {b.compare && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs">
          <span>
            <span className="text-slate-400">Receita:</span>{" "}
            <span className={`font-medium ${pctColor(b.revVar)}`}>{pctText(b.revVar)}</span>
          </span>
          <span>
            <span className="text-slate-400">Lucro:</span>{" "}
            <span className={`font-medium ${pctColor(b.profitVar)}`}>{pctText(b.profitVar)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
