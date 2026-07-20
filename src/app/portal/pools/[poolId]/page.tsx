import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { investorCanSeePool } from "@/lib/portal/access";
import { leavePortal } from "@/lib/actions/portal";

// Ficha do pool no portal (#68) — read-only, com guarda de escopo. A posição completa
// (NAV/unit, TIR, régua a mercado) e os downloads (report, data room filtrado, extrato/K-1)
// reaproveitam a visão do investidor (#59); este é o esqueleto com a guarda de acesso.

export default async function PortalPoolPage({ params }: { params: Promise<{ poolId: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/portal/login");
  const { poolId } = await params;

  if (!(await investorCanSeePool(userId, poolId))) notFound();
  const pool = await prisma.investmentPool.findUnique({
    where: { id: poolId },
    select: { code: true, alias: true, status: true },
  });
  if (!pool) notFound();

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <Image src="/vixus-logo.png" alt="Vixus" width={110} height={38} unoptimized />
          <span className="text-sm text-slate-400">Portal do investidor</span>
        </div>
        <form action={leavePortal}>
          <button className="text-sm text-slate-500 hover:text-[#1f3a5f]">Sair</button>
        </form>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-6">
        <Link href="/portal" className="text-sm text-slate-400 hover:text-[#1f3a5f]">← Meus investimentos</Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-800">
          {pool.code}
          {pool.alias ? ` · ${pool.alias}` : ""}
        </h1>
        <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-400">
          Posição completa, report mensal, data room e extrato/K-1 chegam aqui na próxima etapa —
          reaproveitando a visão do investidor já pronta, agora escopada a você.
        </p>
      </div>
    </main>
  );
}
