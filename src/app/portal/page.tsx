import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { investorPoolMemberships } from "@/lib/portal/access";
import { leavePortal } from "@/lib/actions/portal";
import { PortalEntitySwitcher } from "@/components/portal-entity-switcher";

// Dashboard do portal do investidor (#68) — escopado por entidade (multi). Mostra só os pools
// onde a(s) entidade(s) do login são PoolMember. Posição leve aqui (units + aportado); a ficha
// completa (report, data room, extrato/K-1) fica na página do pool.

const POOL_STATUS: Record<string, { label: string; cls: string }> = {
  FUNDRAISING: { label: "Captação", cls: "bg-blue-50 text-blue-700" },
  ACTIVE: { label: "Ativo", cls: "bg-emerald-50 text-emerald-700" },
  CLOSED: { label: "Encerrado", cls: "bg-slate-100 text-slate-500" },
};
const money = (n: number, cur = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);

export default async function PortalDashboard({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/portal/login");
  const { e: entityKey } = await searchParams;

  const { entities, members } = await investorPoolMemberships(userId, entityKey);

  // posição leve por sócio: units líquidas + aportado (CONTRIBUTION/CAPITAL_CALL)
  const positions = await Promise.all(
    members.map(async (m) => {
      const contribs = await prisma.poolContribution.findMany({
        where: { memberId: m.memberId },
        select: { kind: true, amount: true, units: true },
      });
      let units = 0;
      let invested = 0;
      for (const c of contribs) {
        const u = Number(c.units);
        units += c.kind === "TRANSFER_OUT" ? -u : u;
        if (c.kind === "CONTRIBUTION" || c.kind === "CAPITAL_CALL") invested += Number(c.amount);
      }
      return { ...m, units: Math.round(units * 100) / 100, invested: Math.round(invested) };
    }),
  );

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <Image src="/vixus-logo.png" alt="Vixus" width={110} height={38} unoptimized />
          <span className="text-sm text-slate-400">Portal do investidor</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <PortalEntitySwitcher entities={entities} current={entityKey} />
          <span className="text-slate-300">|</span>
          <form action={leavePortal}>
            <button className="text-slate-500 hover:text-[#1f3a5f]">Sair</button>
          </form>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-6">
        <p className="mb-4 text-sm text-slate-500">
          Seus investimentos ativos — você vê apenas os pools onde é sócio.
        </p>

        {positions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-400">
            Nenhum investimento vinculado a esta entidade ainda.
          </div>
        ) : (
          <div className="grid gap-3">
            {positions.map((p) => {
              const st = POOL_STATUS[p.poolStatus] ?? { label: p.poolStatus, cls: "bg-slate-100 text-slate-500" };
              return (
                <div key={p.memberId} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-800">
                        {p.poolCode}
                        {p.poolAlias ? ` · ${p.poolAlias}` : ""}
                      </div>
                      <div className="text-xs text-slate-400">{p.entityName}</div>
                    </div>
                    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="mb-3 grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-[11px] text-slate-400">Aportado</div>
                      <div className="text-base font-semibold tabular-nums text-slate-800">{money(p.invested, p.currency)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Units</div>
                      <div className="text-base font-semibold tabular-nums text-slate-800">{p.units.toLocaleString("en-US")}</div>
                    </div>
                    <div className="text-right">
                      <Link href={`/portal/pools/${p.poolId}`} className="inline-block rounded-lg bg-[#1f3a5f] px-3 py-2 text-xs font-semibold text-white hover:bg-[#16304f]">
                        Ver posição
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-6 text-[11.5px] leading-relaxed text-slate-400">
          🔒 Somente leitura. Você não enxerga outros sócios, o extrato do financiamento nem os números internos da gestão — apenas a sua posição.
        </p>
      </div>
    </main>
  );
}
