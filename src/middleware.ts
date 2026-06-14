import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Middleware de autenticação (usa apenas a config edge-safe).
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Protege tudo, exceto assets, rotas do Auth.js e a própria tela de login.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|login).*)"],
};
