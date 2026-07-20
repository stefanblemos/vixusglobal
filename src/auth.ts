import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { authConfig } from "./auth.config";
import { consumePortalToken } from "@/lib/portal/access";

/**
 * Auth.js — acesso interno da equipe Vixus (login por e-mail + senha).
 * Sessão via JWT (necessário com Credentials). Papéis: ADMIN / BOOKKEEPER / VIEWER.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
    // Portal do investidor (#68): login por magic-link — a "senha" é o token do e-mail.
    Credentials({
      id: "portal-token",
      name: "Portal (magic-link)",
      credentials: { token: { label: "Token", type: "text" } },
      async authorize(credentials) {
        const token = typeof credentials?.token === "string" ? credentials.token : "";
        const res = await consumePortalToken(token);
        if (!res) return null;
        const user = await prisma.user.findUnique({ where: { id: res.userId } });
        if (!user || user.role !== "INVESTOR") return null;
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
});
