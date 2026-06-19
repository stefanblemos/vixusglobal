import type { NextAuthConfig } from "next-auth";

/**
 * Config "edge-safe" do Auth.js (sem Prisma/bcrypt) — usada pelo proxy
 * (src/proxy.ts) para proteger rotas. Os providers são adicionados em src/auth.ts.
 */
export const authConfig = {
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { nextUrl } = request;
      const isLoggedIn = !!auth?.user;
      const role = (auth?.user as { role?: string } | undefined)?.role;
      const isOnLogin = nextUrl.pathname.startsWith("/login");
      if (isOnLogin) {
        // já logado tentando ver /login → manda para o dashboard
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl));
        return true;
      }
      if (!isLoggedIn) return false;

      // Gestão de usuários: só ADMIN.
      if (nextUrl.pathname.startsWith("/admin") && role !== "ADMIN") {
        return Response.redirect(new URL("/", nextUrl));
      }
      // VIEWER = somente leitura: bloqueia mutações (server actions e uploads são POST).
      const method = request.method.toUpperCase();
      if (role === "VIEWER" && method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        return false;
      }
      return true;
    },
    jwt({ token, user }) {
      if (user) token.role = (user as { role?: string }).role;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        if (token.sub) session.user.id = token.sub;
        if (token.role) session.user.role = token.role as typeof session.user.role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
