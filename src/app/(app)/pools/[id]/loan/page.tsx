import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { buildStatement, ENTRY_TYPE_LABEL } from "@/lib/pools/loan-statement";
import {
  deleteLoanEntry,
  deletePoolLoan,
  generatePayoffFromHouse,
  toggleLoanEntryReconciled,
} from "@/lib/actions/pool-loan";
import { AddLoanEntryForm, PoolLoanTermsForm } from "@/components/pool-loan-forms";
import { HousesByBank, PoolLoiUpload } from "@/components/pool-loan-loi";
import { PoolTabsNav } from "@/components/pool-tabs";
import { LoanMonthFilter } from "@/components/loan-month-filter";

export const dynamic = "force-dynamic";

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";
const thRight = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400";
const td = "px-3 py-1.5 text-sm text-slate-600";
const tdRight = "px-3 py-1.5 text-right text-sm tabular-nums text-slate-700";

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export default async function PoolLoanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; loan?: string }>;
}) {
  const { id } = await params;
  const { month: rawMonth, loan: rawLoan } = await searchParams;
  const pool = await prisma.investmentPool.findUnique({
    where: { id },
    include: {
      houses: { orderBy: { createdAt: "asc" } },
      loans: {
        orderBy: { createdAt: "asc" },
        include: {
          bankProfile: true,
          entries: { include: { house: true }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] },
        },
      },
    },
  });
  if (!pool) notFound();
  // seletor: ?loan=<id> | "new" (formulário vazio p/ criar) | default = primeiro loan
  const creatingNew = rawLoan === "new" || pool.loans.length === 0;
  const loan = creatingNew ? null : (pool.loans.find((l) => l.id === rawLoan) ?? pool.loans[0]);
  const banks = await prisma.bankProfile.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const loanLabel = (l: (typeof pool.loans)[number]) =>
    `${l.bankProfile?.name ?? "Banco a definir"}${l.loanNumber ? ` · ${l.loanNumber}` : ""}`;

  const apr =
    loan?.aprPct != null
      ? Number(loan.aprPct)
      : loan?.bankProfile
        ? loan.bankProfile.rateType === "FIXED"
          ? Number(loan.bankProfile.aprPct)
          : Number(loan.bankProfile.indexPct) + Number(loan.bankProfile.spreadPct)
        : null;

  const stmt = loan
    ? buildStatement(
        // draws PENDENTES (aguardando o banco) ficam fora do saldo até a liberação
        loan.entries.filter((e) => !e.pending).map((e) => ({
          id: e.id,
          type: e.type,
          date: e.date,
          amount: Number(e.amount),
          houseLabel: e.house?.address ?? null,
          memo: e.memo,
          reconciled: e.reconciled,
          createdAt: e.createdAt,
        })),
        apr,
      )
    : null;

  // meses do filtro: do primeiro lançamento até o mês corrente (auto-incremental)
  const monthKey = (d: Date) => d.toISOString().slice(0, 7);
  const months: string[] = [];
  if (stmt && stmt.rows.length > 0) {
    const cursor = new Date(stmt.rows[0].date);
    cursor.setUTCDate(1);
    const end = new Date();
    while (monthKey(cursor) <= monthKey(end)) {
      months.push(monthKey(cursor));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  const month = rawMonth && (rawMonth === "all" || months.includes(rawMonth)) ? rawMonth : "all";
  const visibleRows = stmt
    ? month === "all"
      ? stmt.rows
      : stmt.rows.filter((r) => monthKey(r.date) === month)
    : [];

  // casas vendidas com payoff que ainda não foi lançado no statement — só as DESTE loan
  const payoffLaunched = new Set(
    loan?.entries.filter((e) => e.type === "PAYOFF" && e.houseId).map((e) => e.houseId) ?? [],
  );
  const pendingPayoffs = loan
    ? pool.houses.filter(
        (h) =>
          (h.loanId === loan.id || (h.loanId == null && pool.loans.length === 1)) &&
          h.payoffAmount != null &&
          h.saleDate != null &&
          !payoffLaunched.has(h.id),
      )
    : [];

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/pools/${pool.id}`} className="text-sm text-slate-500 hover:text-slate-700">
          ← {pool.code}
          {pool.alias ? ` · ${pool.alias}` : ""}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">Loan statement</h1>
        <p className="text-sm text-slate-500">
          O extrato interno do construction loan — draws, juros reais, fees e payoffs lançados
          aqui; o saldo devido é calculado e cada linha pode ser conciliada (✓) com o extrato do
          banco. Draws novos entram pela tela{" "}
          <Link href="/pools/draws" className="text-[#1f3a5f] hover:underline">
            Draws
          </Link>
          .
        </p>
      </div>

      <PoolTabsNav poolId={pool.id} active="loan" />

      {/* Um pool pode ter N loans (bancos diferentes por grupo de casas) — seletor */}
      {pool.loans.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {pool.loans.map((l) => (
            <Link
              key={l.id}
              href={`/pools/${pool.id}/loan?loan=${l.id}`}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                loan?.id === l.id
                  ? "border-[#1f3a5f] bg-[#1f3a5f] font-medium text-white"
                  : "border-slate-300 text-slate-600 hover:border-slate-400"
              }`}
            >
              {loanLabel(l)}
            </Link>
          ))}
          <Link
            href={`/pools/${pool.id}/loan?loan=new`}
            className={`rounded-full border border-dashed px-3 py-1.5 text-sm transition ${
              creatingNew
                ? "border-[#1f3a5f] font-medium text-[#1f3a5f]"
                : "border-slate-300 text-slate-500 hover:border-slate-400"
            }`}
          >
            + Novo loan
          </Link>
        </div>
      )}

      {/* LOI no pool (15/07): AI captura as condições e preenche o loan */}
      <PoolLoiUpload
        poolId={pool.id}
        banks={banks}
        loans={pool.loans.map((l) => ({ id: l.id, label: loanLabel(l) }))}
      />

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-medium text-slate-800">
            {creatingNew && pool.loans.length > 0 ? "Novo loan" : "Termos do loan"}
          </h2>
          {loan && loan.entries.length === 0 && (
            <form action={deletePoolLoan}>
              <input type="hidden" name="loanId" value={loan.id} />
              <input type="hidden" name="poolId" value={pool.id} />
              <button
                type="submit"
                className="text-xs text-slate-400 hover:text-red-500"
                title="Remove o loan (só é possível sem lançamentos; as casas voltam a 'sem loan')"
              >
                ✕ Remover loan
              </button>
            </form>
          )}
        </div>
        <PoolLoanTermsForm
          key={loan?.id ?? "new"}
          poolId={pool.id}
          loanId={loan?.id ?? null}
          banks={banks}
          loan={
            loan
              ? {
                  bankProfileId: loan.bankProfileId,
                  loanNumber: loan.loanNumber,
                  committed: loan.committed?.toString() ?? null,
                  aprPct: loan.aprPct?.toString() ?? null,
                  expectedClosingDate: loan.expectedClosingDate ? fmtDate(loan.expectedClosingDate) : null,
                  closingDate: loan.closingDate ? fmtDate(loan.closingDate) : null,
                  notes: loan.notes,
                }
              : null
          }
        />
      </section>

      {/* Casas por banco (15/07): o VHP-II tem 3 bancos — cada casa aponta p/ seu loan */}
      {pool.loans.length > 0 && pool.houses.length > 0 && (
        <HousesByBank
          poolId={pool.id}
          houses={pool.houses.map((h) => ({
            id: h.id,
            address: h.address,
            status: h.status,
            loanId: h.loanId,
          }))}
          loans={pool.loans.map((l) => ({ id: l.id, label: loanLabel(l) }))}
        />
      )}

      {loan && stmt && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card
              label={
                stmt.totalPayoffs > 0 && stmt.balance <= 0.01 ? "Saldo devido — QUITADO" : "Saldo devido"
              }
              value={formatMoney(stmt.balance, pool.currency)}
              hint={
                stmt.totalPayoffs > 0 && stmt.balance <= 0.01
                  ? `quitado em ${stmt.rows[stmt.rows.length - 1]?.date.toISOString().slice(0, 10)}${stmt.balance < -0.01 ? ` · crédito ${formatMoney(-stmt.balance, pool.currency)} volta ao caixa do pool` : ""}`
                  : loan.committed
                    ? `${((stmt.totalDraws / Number(loan.committed)) * 100).toFixed(1)}% do comprometido sacado`
                    : undefined
              }
            />
            <Card
              label="Juros reais lançados"
              value={formatMoney(stmt.totalInterest, pool.currency)}
              hint={
                apr != null
                  ? `esperado ${formatMoney(stmt.totalExpectedInterest, pool.currency)} (APR ${apr}%)`
                  : "defina o APR para conferência"
              }
            />
            <Card
              label="Draws + fees"
              value={formatMoney(stmt.totalDraws, pool.currency)}
              hint={`fees ${formatMoney(stmt.totalFees, pool.currency)}`}
            />
            <Card
              label="Payoffs / créditos"
              value={formatMoney(stmt.totalPayoffs, pool.currency)}
              hint={`créditos ${formatMoney(stmt.totalCredits, pool.currency)} · conciliado ${stmt.reconciledCount}/${stmt.rows.length}`}
            />
          </div>

          {pendingPayoffs.length > 0 && (
            <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <p className="mb-2 text-sm text-amber-800">
                Casas vendidas com payoff ainda não lançado no statement:
              </p>
              <div className="flex flex-wrap gap-2">
                {pendingPayoffs.map((h) => (
                  <form key={h.id} action={generatePayoffFromHouse}>
                    <input type="hidden" name="poolId" value={pool.id} />
                    <input type="hidden" name="houseId" value={h.id} />
                    <button
                      type="submit"
                      className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-100"
                    >
                      Lançar payoff • {h.address} · {formatMoney(h.payoffAmount!, pool.currency)}
                    </button>
                  </form>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-end justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-base font-medium text-slate-800">Statement</h2>
                <p className="text-xs text-slate-400">
                  Nas linhas de juro, "esperado" é o accrual diário (APR/360) sobre o saldo — o
                  delta confere a cobrança do banco. O saldo é sempre acumulado desde o início.
                </p>
              </div>
              <LoanMonthFilter months={months} value={month} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className={th}>Data</th>
                    <th className={th}>Tipo</th>
                    <th className={th}>Casa / memo</th>
                    <th className={thRight}>Valor</th>
                    <th className={thRight}>Saldo devido</th>
                    <th className={thRight}>Esperado (juro)</th>
                    <th className={thRight}>✓</th>
                    <th className={thRight}></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-5 py-6 text-center text-sm text-slate-400">
                        {month === "all"
                          ? "Nenhum lançamento ainda — comece pelos fees do closing e a reserve."
                          : "Nenhum lançamento neste mês."}
                      </td>
                    </tr>
                  )}
                  {visibleRows.map((e) => (
                    <tr key={e.id} className={`border-b border-slate-50 ${e.reconciled ? "" : "bg-amber-50/30"}`}>
                      <td className={td}>{fmtDate(e.date)}</td>
                      <td className={td}>
                        <span
                          className={`text-xs ${
                            e.type === "PAYOFF" || e.type === "CREDIT"
                              ? "text-emerald-700"
                              : e.type === "INTEREST"
                                ? "text-blue-700"
                                : "text-slate-500"
                          }`}
                        >
                          {ENTRY_TYPE_LABEL[e.type] ?? e.type}
                        </span>
                      </td>
                      <td className={`${td} text-slate-500`}>
                        {e.houseLabel ?? ""}
                        {e.houseLabel && e.memo ? " · " : ""}
                        {e.memo ?? ""}
                      </td>
                      <td className={`${tdRight} ${e.amount < 0 ? "text-emerald-700" : ""}`}>
                        {formatMoney(e.amount, pool.currency)}
                      </td>
                      <td className={`${tdRight} font-medium`}>{formatMoney(e.balance, pool.currency)}</td>
                      <td className={tdRight}>
                        {e.expectedInterest != null ? (
                          <span
                            title={`delta ${formatMoney(e.interestDelta ?? 0, pool.currency)}`}
                            className={
                              Math.abs(e.interestDelta ?? 0) > Math.abs(e.expectedInterest) * 0.05
                                ? "text-amber-600"
                                : "text-slate-400"
                            }
                          >
                            {formatMoney(e.expectedInterest, pool.currency)}
                          </span>
                        ) : (
                          ""
                        )}
                      </td>
                      <td className={tdRight}>
                        <form action={toggleLoanEntryReconciled} className="inline">
                          <input type="hidden" name="entryId" value={e.id} />
                          <input type="hidden" name="poolId" value={pool.id} />
                          <button
                            type="submit"
                            title={e.reconciled ? "Conciliado — clique para desfazer" : "Marcar como conciliado com o extrato"}
                            className={e.reconciled ? "text-emerald-600" : "text-slate-300 hover:text-emerald-600"}
                          >
                            ✓
                          </button>
                        </form>
                      </td>
                      <td className={tdRight}>
                        <form action={deleteLoanEntry} className="inline">
                          <input type="hidden" name="entryId" value={e.id} />
                          <input type="hidden" name="poolId" value={pool.id} />
                          <button type="submit" className="text-xs text-slate-300 hover:text-red-500" title="Delete">
                            ✕
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-100 px-5 py-4">
              <AddLoanEntryForm
                poolId={pool.id}
                loanId={loan.id}
                houses={pool.houses
                  .filter((h) => h.loanId === loan.id || h.loanId == null)
                  .map((h) => ({ id: h.id, address: h.address }))}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
