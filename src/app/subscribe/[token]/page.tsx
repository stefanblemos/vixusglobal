import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { SubscriptionWizard } from "@/app/subscribe/[token]/wizard";
import type { WizardData } from "@/lib/subscription/types";

// Wizard público de subscrição (mock aprovado 19/07/2026). O token do link é o
// segredo — a rota é liberada no auth.config. Pré-preenchimento: draft da própria
// subscrição > perfil KYC da entidade vinculada > última subscrição assinada do
// mesmo e-mail (investidor recorrente ⇒ banner "revise seus dados").
export const dynamic = "force-dynamic";

export default async function SubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sub = await prisma.poolSubscription.findUnique({
    where: { token },
    include: {
      pool: { select: { name: true, code: true, alias: true, unitPrice: true, houses: { select: { id: true } } } },
      party: { select: { name: true, investorProfile: { select: { data: true } } } },
      company: { select: { legalName: true, investorProfile: { select: { data: true } } } },
    },
  });
  if (!sub) notFound();

  let initialData: WizardData | null = (sub.data as WizardData | null) ?? null;
  let prefilled = sub.prefilled;
  let prefillFresh = false; // veio de perfil AGORA (ainda não salvo no draft)
  if (!initialData) {
    const profile =
      (sub.party?.investorProfile?.data as WizardData | undefined) ??
      (sub.company?.investorProfile?.data as WizardData | undefined) ??
      null;
    let fallback: WizardData | null = null;
    if (!profile && sub.email) {
      const prev = await prisma.poolSubscription.findFirst({
        where: { email: sub.email, status: { in: ["SIGNED", "ACCEPTED"] }, id: { not: sub.id } },
        orderBy: { signedAt: "desc" },
        select: { data: true },
      });
      fallback = (prev?.data as WizardData | null) ?? null;
    }
    const source = profile ?? fallback;
    if (source) {
      const { units: _units, ...rest } = source;
      initialData = rest;
      prefilled = true;
      prefillFresh = true;
    }
  }

  return (
    <SubscriptionWizard
      token={token}
      poolName={sub.pool.name}
      poolCode={sub.pool.alias ?? sub.pool.code}
      houseCount={sub.pool.houses.length}
      unitPrice={Number(sub.unitPrice)}
      suggestedUnits={sub.units ? Number(sub.units) : null}
      status={sub.status}
      initialData={initialData}
      prefilled={prefilled}
      prefillFresh={prefillFresh}
      email={sub.email}
      signedAt={sub.signedAt?.toISOString().slice(0, 10) ?? null}
    />
  );
}
