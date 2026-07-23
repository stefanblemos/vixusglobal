import { headers } from "next/headers";

// Base pública da app a partir do PRÓPRIO request (a Vercel não tem NEXTAUTH_URL/APP_URL).
// Mesmo critério do portal (host/proto do forwarded) — funciona em prod/preview/local.
export async function appBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ||
    "http://localhost:3005"
  );
}
