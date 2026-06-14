import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Middleware de autenticação (usa apenas a config edge-safe).
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Protege tudo, exceto rotas do Auth.js, internos do Next e arquivos estáticos
  // do /public (qualquer caminho com extensão, ex.: .png, .svg, .ico).
  matcher: ["/((?!api/auth|_next/static|_next/image|.*\\..*).*)"],
};
