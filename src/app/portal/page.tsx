import Image from "next/image";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { investorEntities } from "@/lib/portal/access";
import { loadInvestorPortfolio } from "@/lib/pools/investor-portfolio";
import { INV_LANG_COOKIE, langFromCookie } from "@/lib/pools/i18n";
import { InvestorPortfolioView } from "@/components/investor-portfolio-view";
import { leavePortal } from "@/lib/actions/portal";
import { PortalEntitySwitcher } from "@/components/portal-entity-switcher";
import { PortalPayoutCard } from "@/components/portal-payout-card";
import { payoutForEntityKey } from "@/lib/pools/payout-data";
import { payoutStatus } from "@/lib/pools/payout";

export const dynamic = "force-dynamic";

// Home do portal do investidor (#68): a MESMA visão consolidada do app interno
// (@/components/investor-portfolio-view), escopada à entidade do login. Sem o voltar
// para a lista de entidades e sem o link "ver projeto" (que leva ao app do operador).

const VTABS = ["overview", "statement", "tax"] as const;

export default async function PortalHome({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; tab?: string }>;
}) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/portal/login");

  const { e: rawEntity, tab: rawTab } = await searchParams;
  const vtab = VTABS.includes(rawTab as (typeof VTABS)[number]) ? (rawTab as string) : "overview";
  const lang = langFromCookie((await cookies()).get(INV_LANG_COOKIE)?.value);
  const dateLocale = (await headers()).get("accept-language")?.split(",")[0]?.trim() || "en-US";

  const entities = await investorEntities(userId);
  // escopo: só entidades REALMENTE vinculadas a este login (não aceita ?e= arbitrário)
  const current = entities.find((x) => x.key === rawEntity) ?? entities[0];

  const p = current ? await loadInvestorPortfolio(current.key) : null;
  // Conta de recebimento (#69): o próprio sócio confirma aqui.
  const payoutAcc = current ? await payoutForEntityKey(current.key) : null;
  const payoutCard = current
    ? {
        status: payoutStatus(payoutAcc),
        beneficiaryName: payoutAcc?.beneficiaryName ?? "",
        bankName: payoutAcc?.bankName ?? "",
        routingNumber: payoutAcc?.routingNumber ?? null,
        accountNumber: payoutAcc?.accountNumber ?? "",
        accountType: payoutAcc?.accountType ?? null,
        swift: payoutAcc?.swift ?? null,
        iban: payoutAcc?.iban ?? null,
        bankAddress: payoutAcc?.bankAddress ?? null,
        confirmedAt: payoutAcc?.confirmedAt
          ? payoutAcc.confirmedAt.toLocaleDateString(dateLocale, { day: "2-digit", month: "short", year: "numeric" })
          : null,
      }
    : null;
  const taxDocs =
    p && vtab === "tax"
      ? await prisma.poolDocument.findMany({
          where: { memberId: { in: p.memberIds } },
          orderBy: [{ signedAt: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            docType: true,
            fileName: true,
            createdAt: true,
            signedAt: true,
            pdfSize: true,
            pool: { select: { code: true } },
          },
        })
      : [];

  const qs = (tb: string) => `/portal?tab=${tb}${current ? `&e=${encodeURIComponent(current.key)}` : ""}`;

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <Image src="/vixus-logo.png" alt="Vixus" width={110} height={38} unoptimized />
          <span className="text-sm text-slate-400">Portal do investidor</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <PortalEntitySwitcher entities={entities} current={current?.key} />
          <span className="text-slate-300">|</span>
          <form action={leavePortal}>
            <button className="text-slate-500 hover:text-[#1f3a5f]">Sair</button>
          </form>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-5">
        {current && payoutCard && (
          <PortalPayoutCard entityKey={current.key} entityName={current.name} account={payoutCard} />
        )}
        {p ? (
          <InvestorPortfolioView
            p={p}
            lang={lang}
            dateLocale={dateLocale}
            vtab={vtab}
            taxDocs={taxDocs}
            backHref={null}
            tabHref={qs}
            showProjectLink={false}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-400">
            Nenhum investimento vinculado a este acesso ainda.
          </div>
        )}
        <p className="mt-6 text-[11.5px] leading-relaxed text-slate-400">
          🔒 Somente leitura. Você não enxerga outros sócios, o extrato do financiamento nem os números internos da
          gestão — apenas a sua posição.
        </p>
      </div>
    </main>
  );
}
