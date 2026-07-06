import { auth } from "@/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { cookieYear } from "@/lib/year";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const currentYear = new Date().getUTCFullYear();
  const gYear = (await cookieYear()) ?? currentYear - 1;
  const years = Array.from({ length: currentYear - 2018 }, (_, i) => currentYear - i); // currentYear..2019

  return (
    <div className="flex min-h-screen bg-slate-50">
      <AppSidebar email={session?.user?.email} role={session?.user?.role} year={gYear} years={years} />
      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
