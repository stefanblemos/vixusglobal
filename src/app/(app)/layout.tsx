import { auth } from "@/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { cookieYear } from "@/lib/year";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const currentYear = new Date().getUTCFullYear();
  const gYear = (await cookieYear()) ?? currentYear - 1;
  const years = Array.from({ length: currentYear - 2018 }, (_, i) => currentYear - i); // currentYear..2019

  return (
    <div className="flex min-h-screen bg-slate-50 print:block print:min-h-0 print:bg-white">
      {/* impressão (19/07): o shell some — o que imprime é só o documento (ex.: report mensal) */}
      <div className="contents print:hidden">
        <AppSidebar email={session?.user?.email} role={session?.user?.role} year={gYear} years={years} />
      </div>
      <main className="flex-1 overflow-x-hidden print:overflow-visible">
        <div className="mx-auto max-w-6xl px-8 py-8 print:max-w-none print:p-0">{children}</div>
      </main>
    </div>
  );
}
