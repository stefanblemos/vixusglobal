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
      // Portal do investidor (#68): login e magic-link são públicos (o token é o segredo).
      if (nextUrl.pathname.startsWith("/portal/login") || nextUrl.pathname.startsWith("/portal/enter")) return true;
      const isOnLogin = nextUrl.pathname.startsWith("/login");
      if (isOnLogin) {
        // já logado tentando ver /login → manda para o dashboard
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl));
        return true;
      }
      if (!isLoggedIn) return false;

      const method = request.method.toUpperCase();
      const isMutation = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";

      // INVESTOR (#68): sandbox no portal — só /portal*, read-only e sem o resto do app.
      // O escopo por entidade é resolvido nas páginas do portal (InvestorAccess).
      if (role === "INVESTOR") {
        const inPortal = nextUrl.pathname.startsWith("/portal");
        if (!inPortal) return Response.redirect(new URL("/portal", nextUrl));
        // troca de entidade e logout do portal são POSTs legítimos; demais mutações barradas
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
