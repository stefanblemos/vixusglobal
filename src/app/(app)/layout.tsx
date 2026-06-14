import Link from "next/link";
import { auth } from "@/auth";
import { logout } from "@/lib/actions/auth";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/companies", label: "Empresas" },
  { href: "/parties", label: "Donos" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-lg font-semibold tracking-tight text-slate-800">
              VIX<span className="text-[#8DC63F]">US</span>
            </Link>
            <nav className="flex gap-5 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-slate-600 hover:text-slate-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-500">
              {session?.user?.email}
              {session?.user?.role ? ` · ${session.user.role}` : ""}
            </span>
            <form action={logout}>
              <button className="rounded-md border border-slate-300 px-3 py-1 text-slate-600 hover:bg-slate-100">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
