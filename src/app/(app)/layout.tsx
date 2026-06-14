import { auth } from "@/auth";
import { AppSidebar } from "@/components/app-sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <AppSidebar email={session?.user?.email} role={session?.user?.role} />
      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
