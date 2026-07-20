import { enterPortal } from "@/lib/actions/portal";
import { AutoSubmit } from "./auto-submit";

// Consome o magic-link: submete o token à sessão do portal (Credentials "portal-token").
// Auto-submit no cliente (o token vai por POST, não fica na querystring do signIn).
export default async function PortalEnterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <form action={enterPortal}>
        <input type="hidden" name="token" value={token} />
        <AutoSubmit />
        <p className="text-sm text-slate-500">Entrando no portal…</p>
      </form>
    </main>
  );
}
