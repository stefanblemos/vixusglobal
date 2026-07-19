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
      // Wizard público de subscrição (o token cuid do link é o segredo; mock 19/07).
      if (nextUrl.pathname.startsWith("/subscribe")) return true;
      const isOnLogin = nextUrl.pathname.startsWith("/login");
      if (isOnLogin) {
        // já logado tentando ver /login → manda para o dashboard
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl));
        return true;
      }
      if (!isLoggedIn) return false;

      const method = request.method.toUpperCase();
      const isMutation = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";

      // INVESTOR (#67, Leva 2): sandbox no portal do investidor — só /pools/investors*
      // (a vinculação sessão→entidade vem no portal, #68). Read-only e sem o resto do app.
      if (role === "INVESTOR") {
        const inPortal = nextUrl.pathname.startsWith("/pools/investors");
        if (!inPortal) return Response.redirect(new URL("/pools/investors", nextUrl));
        if (isMutation) return false;
        return true;
      }

      // Gestão de usuários: só ADMIN (OPERATOR opera pools mas não mexe em usuários).
      if (nextUrl.pathname.startsWith("/admin") && role !== "ADMIN") {
        return Response.redirect(new URL("/", nextUrl));
      }
      // VIEWER = somente leitura: bloqueia mutações (server actions e uploads são POST).
      if (role === "VIEWER" && isMutation) {
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
