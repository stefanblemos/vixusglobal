import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { loadInvestorPortfolio } from "@/lib/pools/investor-portfolio";
import { INV_LANG_COOKIE, langFromCookie } from "@/lib/pools/i18n";
import { InvestorPortfolioView } from "@/components/investor-portfolio-view";

export const dynamic = "force-dynamic";

// Fase 4 (mock v2 aprovado): a tela do investidor — portfólio inteiro em um lugar só.
// O RENDER mora em @/components/investor-portfolio-view (compartilhado com o portal, #68).
// Aqui é o "ver como investidor" do operador: tem o voltar p/ a lista e o link "ver projeto".

const VTABS = ["overview", "statement", "tax"] as const;

export default async function InvestorPortfolioPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { key } = await params;
  const { tab: rawTab } = await searchParams;
  const vtab = VTABS.includes(rawTab as (typeof VTABS)[number]) ? (rawTab as string) : "overview";
  const lang = langFromCookie((await cookies()).get(INV_LANG_COOKIE)?.value);
  const dateLocale = (await headers()).get("accept-language")?.split(",")[0]?.trim() || "en-US";

  const p = await loadInvestorPortfolio(key);
  if (!p) notFound();

  const taxDocs =
    vtab === "tax"
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

  return (
    <InvestorPortfolioView
      p={p}
      lang={lang}
      dateLocale={dateLocale}
      vtab={vtab}
      taxDocs={taxDocs}
      backHref="/pools/investors"
      tabHref={(tb) => `/pools/investors/${key}?tab=${tb}`}
      showProjectLink
    />
  );
}
