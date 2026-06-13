import type { DefaultSession } from "next-auth";
import type { UserRole } from "@prisma/client";

// Estende os tipos do Auth.js para incluir id e papel do usuário na sessão.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role?: UserRole;
    } & DefaultSession["user"];
  }
}
