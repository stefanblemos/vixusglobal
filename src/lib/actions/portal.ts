"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/db";
import { auth, signIn, signOut } from "@/auth";
import { createPortalToken } from "@/lib/portal/access";
import { logInvestmentAudit } from "@/lib/audit";

/**
 * Portal do investidor (#68) — geração de acesso por magic-link.
 * - requestPortalLink: o próprio investidor pede o link na tela de login (público).
 * - grantPortalAccess: o operador cria/vincula o login INVESTOR de um sócio e gera o 1º link.
 * Sem mailer ainda (#69): o operador copia o link e envia; a tela pública responde genérico.
 */

export type PortalFormState = { error?: string; ok?: boolean; link?: string; message?: string } | undefined;

const norm = (e: string) => e.trim().toLowerCase();

// Base do link do magic-link: vem do PRÓPRIO request (host/proto), então funciona em
// produção, preview e local sem depender de env — a Vercel não tem NEXTAUTH_URL setada.
async function baseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ||
    "http://localhost:3005"
  );
}

// Público: o investidor pede o link na tela de login. Resposta SEMPRE genérica (não vaza
// quais e-mails têm conta). Quando #69 fiar o e-mail, o link é enviado de verdade.
export async function requestPortalLink(_prev: PortalFormState, formData: FormData): Promise<PortalFormState> {
  const email = norm(String(formData.get("email") ?? ""));
  if (!email || !email.includes("@")) return { error: "Informe um e-mail válido." };
  const user = await prisma.user.findFirst({
    where: { email, role: "INVESTOR" },
    select: { id: true, investorAccess: { select: { id: true }, take: 1 } },
  });
  if (user && user.investorAccess.length > 0) {
    await createPortalToken(email); // TODO(#69): enviar por e-mail
  }
  return { ok: true, message: "Se este e-mail tiver acesso, enviamos um link para entrar. Verifique sua caixa de entrada." };
}

// Consome o magic-link e abre a sessão do portal. Token inválido → volta ao login com erro.
export async function enterPortal(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  try {
    await signIn("portal-token", { token, redirectTo: "/portal" });
  } catch (error) {
    if (error instanceof AuthError) redirect("/portal/login?error=expired");
    throw error; // deixa o NEXT_REDIRECT do signIn propagar
  }
}

export async function leavePortal() {
  await signOut({ redirectTo: "/portal/login" });
}

// Operador/ADMIN: garante o login INVESTOR do sócio (por e-mail) vinculado à ENTIDADE dele
// e devolve o 1º link de acesso ao portal (para copiar/enviar até o e-mail automático existir).
export async function grantPortalAccess(_prev: PortalFormState, formData: FormData): Promise<PortalFormState> {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN" && role !== "OPERATOR") return { error: "Sem permissão." };

  const memberId = String(formData.get("memberId") ?? "").trim();
  const email = norm(String(formData.get("email") ?? ""));
  if (!email || !email.includes("@")) return { error: "Informe um e-mail válido." };

  const member = await prisma.poolMember.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      poolId: true,
      partyId: true,
      companyId: true,
      party: { select: { name: true } },
      company: { select: { legalName: true, tradeName: true } },
    },
  });
  if (!member) return { error: "Sócio não encontrado." };
  if (!member.partyId && !member.companyId) return { error: "Este sócio não tem entidade (Party/Company) vinculada." };

  // 1) User INVESTOR do e-mail (cria se não houver; não rebaixa staff existente)
  let user = await prisma.user.findFirst({ where: { email } });
  if (!user) {
    const entityName = member.party?.name || member.company?.tradeName || member.company?.legalName || null;
    user = await prisma.user.create({ data: { email, name: entityName, role: "INVESTOR" } });
  } else if (user.role !== "INVESTOR" && user.role !== "ADMIN") {
    // e-mail já é de staff (VIEWER/OPERATOR): não mexe no papel, mas segue vinculando o acesso
  }

  // 2) InvestorAccess → entidade do sócio (idempotente)
  await prisma.investorAccess.upsert({
    where: member.partyId
      ? { userId_partyId: { userId: user.id, partyId: member.partyId } }
      : { userId_companyId: { userId: user.id, companyId: member.companyId! } },
    create: { userId: user.id, partyId: member.partyId, companyId: member.companyId },
    update: {},
  });

  // 3) token + link
  const raw = await createPortalToken(email);
  const link = `${await baseUrl()}/portal/enter/${raw}`;

  await logInvestmentAudit({
    poolId: member.poolId,
    entity: "POOL",
    entityId: member.id,
    action: "UPDATE",
    summary: `Acesso ao portal concedido a ${email} (${member.party?.name || member.company?.tradeName || member.company?.legalName || "entidade"})`,
  });
  revalidatePath(`/pools/${member.poolId}`);
  return { ok: true, link, message: "Acesso criado. Copie o link e envie ao investidor (válido por 15 min)." };
}
