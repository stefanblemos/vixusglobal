import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Proxy de autenticação (convenção do Next.js 16, ex-"middleware") — usa apenas a
// config edge-safe. O Next 16 não reconhece o export via destructuring
// (`export const { auth: proxy } = …`), então exportamos a função `auth` como default.
const { auth } = NextAuth(authConfig);
export default auth;

export const config = {
  // Protege tudo, exceto rotas do Auth.js, internos do Next e arquivos estáticos
  // do /public (qualquer caminho com extensão, ex.: .png, .svg, .ico).
  matcher: ["/((?!api/auth|_next/static|_next/image|.*\\..*).*)"],
};
