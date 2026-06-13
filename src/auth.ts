import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";

/**
 * Configuração do Auth.js (acesso interno da equipe Vixus).
 *
 * Fase 0: esqueleto. O `authorize` real (verificação de senha com hash,
 * papéis ADMIN/BOOKKEEPER/VIEWER, tela de login e cadastro de usuários)
 * é implementado na Fase 1.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(_credentials) {
        // TODO(Fase 1): buscar usuário por e-mail e validar passwordHash (bcrypt).
        return null;
      },
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
