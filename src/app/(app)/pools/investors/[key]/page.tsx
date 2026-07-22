import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { loadInvestorPortfolio } from "@/lib/pools/investor-portfolio";
import { INV_LANG_COOKIE, langFromCookie } from "@/lib/pools/i18n";
import { InvestorPortfolioView } from "@/components/investor-portfolio-view";
import { InvestorLegacyPanel } from "@/components/investor-legacy-panel";

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

  // Saldo de abertura (projetos anteriores) — painel exclusivo de ADMIN, só na aba Extrato.
  // Nunca vai para o portal do investidor: quem passa este slot é apenas esta página.
  const role = ((await auth())?.user as { role?: string } | undefined)?.role;
  let legacyPanel: React.ReactNode = null;
  if (role === "ADMIN" && vtab === "statement") {
    const kind = key.slice(0, 1);
    const id = key.slice(2);
    const legacy = await prisma.investorLegacy.findFirst({
      where: kind === "c" ? { companyId: id } : { partyId: id },
      include: { entries: { orderBy: { date: "asc" } } },
    });
    legacyPanel = (
      <InvestorLegacyPanel
        entityKey={key}
        values={{
          rows: (legacy?.entries ?? []).map((e) => ({
            date: e.date.toISOString().slice(0, 10),
            kind: e.kind,
            amount: Number(e.amount),
            label: e.label,
          })),
          note: legacy?.note ?? null,
          locked: !!legacy?.lockedAt,
        }}
      />
    );
  }

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
      legacyPanel={legacyPanel}
    />
  );
}
