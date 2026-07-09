import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { DrawHousesPanel, type HouseAvailability } from "@/components/pool-draw-houses";
import { DrawList, type DrawRow } from "@/components/pool-draw-list";

export const dynamic = "force-dynamic";

const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const TABS = [
  ["houses", "Casas"],
  ["ledger", "Ledger de draws"],
] as const;

// Detalhe do loan na tela de Draws: aba Casas (disponibilidade + clique abre o modal de
// solicitação) e aba Ledger (draws do loan, pendentes primeiro, edição/liberação inline).
export default async function DrawLoanPage({
  params,
  searchParams,
}: {
  params: Promise<{ poolId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { poolId } = await params;
  const { tab: rawTab } = await searchParams;
  const tab = TABS.some(([t]) => t === rawTab) ? (rawTab as string) : "houses";

  const pool = await prisma.investmentPool.findUnique({
    where: { id: poolId },
    include: {
      houses: {
        orderBy: { createdAt: "asc" },
        include: { catalogModel: true, catalogLocation: true },
      },
      loan: {
        include: {
          bankProfile: true,
          entries: {
            where: { type: "DRAW" },
            orderBy: [{ pending: "desc" }, { date: "desc" }, { createdAt: "desc" }],
            include: { house: true },
          },
        },
      },
    },
  });
  if (!pool || !pool.loan) notFound();
  const loan = pool.loan;
  const b = loan.bankProfile;

  const feeBits: string[] = [];
  if (b) {
    if (Number(b.drawProcessingFee) > 0) feeBits.push(`$${Number(b.drawProcessingFee)} processing`);
    if (Number(b.inspectionFeePerDraw) > 0) feeBits.push(`$${Number(b.inspectionFeePerDraw)} inspection`);
    if (Number(b.achFeePerBatch) > 0) feeBits.push(`$${Number(b.achFeePerBatch)} ACH por lote`);
  }
  const feesHint =
    feeBits.length > 0 ? `Fees previstos na liberação (${b?.name}): ${feeBits.join(" + ")}.` : "";
  const poolLabel = `${pool.code}${pool.alias ? ` · ${pool.alias}` : ""} — ${b?.name ?? "banco a definir"}${loan.loanNumber ? ` (${loan.loanNumber})` : ""}`;

  // disponibilidade por casa
  const agg = new Map<string, { credited: number; pending: number }>();
  for (const e of loan.entries) {
    const k = e.houseId ?? "__none__";
    const cur = agg.get(k) ?? { credited: 0, pending: 0 };
    if (e.pending) cur.pending += Number(e.requestedAmount ?? 0);
    else cur.credited += Number(e.amount);
    agg.set(k, cur);
  }
  const houses: HouseAvailability[] = pool.houses.map((h) => {
    const a = agg.get(h.id) ?? { credited: 0, pending: 0 };
    const budget = h.bankLoanAmount == null ? null : Number(h.bankLoanAmount);
    const modelLabel =
      h.catalogModel || h.catalogLocation
        ? [h.catalogModel?.name, h.catalogLocation?.name].filter(Boolean).join(" · ")
        : null;
    return {
      id: h.id,
      address: h.address,
      modelLabel,
      budget,
      credited: a.credited,
      pendingAmount: a.pending,
      available: budget == null ? null : budget - a.credited - a.pending,
    };
  });
  const none = agg.get("__none__");
  if (none) {
    houses.push({
      id: null,
      address: "(draws sem casa)",
      modelLabel: null,
      budget: null,
      credited: none.credited,
      pendingAmount: none.pending,
      available: null,
    });
  }

  const drawRows: DrawRow[] = loan.entries.map((d) => ({
    id: d.id,
    poolId: pool.id,
    poolCode: pool.code,
    houseId: d.houseId,
    houseAddress: d.house?.address ?? null,
    pending: d.pending,
    requestedAmount: d.requestedAmount?.toString() ?? null,
    requestDate: fmtDate(d.requestDate),
    amount: d.amount.toString(),
    date: fmtDate(d.date)!,
    reconciled: d.reconciled,
    memo: d.memo,
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/pools/draws" className="text-sm text-slate-500 hover:text-slate-700">
          ← Draws
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">{poolLabel}</h1>
        <p className="text-sm text-slate-500">
          Solicite pelo bloco da casa; a liberação entra no{" "}
          <Link href={`/pools/${pool.id}/loan`} className="text-[#1f3a5f] hover:underline">
            loan statement
          </Link>{" "}
          com os fees do contrato.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={`/pools/draws/${pool.id}?tab=${key}`}
            className={`rounded-t-lg border-b-2 px-4 py-2 text-sm transition ${
              tab === key
                ? "border-[#1f3a5f] font-medium text-[#1f3a5f]"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {tab === "houses" && (
        <DrawHousesPanel poolId={pool.id} poolLabel={poolLabel} feesHint={feesHint} houses={houses} />
      )}

      {tab === "ledger" && (
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-medium text-slate-800">Ledger de draws</h2>
            <p className="text-xs text-slate-400">
              Pendentes primeiro. Clique na linha para editar / registrar a liberação. ✓ =
              conciliado com o extrato.
            </p>
          </div>
          <DrawList
            draws={drawRows}
            housesByPool={{ [pool.id]: pool.houses.map((h) => ({ id: h.id, address: h.address })) }}
          />
        </section>
      )}
    </div>
  );
}
