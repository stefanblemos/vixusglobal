import type { DefaultSession } from "next-auth";
import type { UserRole } from "@prisma/client";

// Estende os tipos do Auth.js para incluir id e papel do usuário.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role?: UserRole;
    } & DefaultSession["user"];
  }
  interface User {
    role?: UserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole;
  }
}
