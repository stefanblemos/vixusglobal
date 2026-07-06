"use server";

import { cookies } from "next/headers";
import { YEAR_COOKIE } from "@/lib/year";

// Grava o ano global no cookie (só pode ser setado em server action / route handler, não no render).
export async function setGlobalYear(year: number): Promise<void> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return;
  (await cookies()).set(YEAR_COOKIE, String(year), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
