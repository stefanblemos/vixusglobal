"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Users,
  ArrowLeftRight,
  Scale,
  BookOpen,
  Landmark,
  ReceiptText,
  PieChart,
  Activity,
  FolderOpen,
  LogOut,
} from "lucide-react";
import { logout } from "@/lib/actions/auth";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/parties", label: "Owners", icon: Users },
  { href: "/loans", label: "Loans", icon: ArrowLeftRight },
  { href: "/exposure", label: "Exposure", icon: Scale },
  { href: "/ledger", label: "Ledger", icon: BookOpen },
  { href: "/bank", label: "Bank", icon: Landmark },
  { href: "/audit", label: "Audit", icon: Activity },
  { href: "/import", label: "Documents", icon: FolderOpen },
  { href: "/tax", label: "Tax", icon: ReceiptText },
  { href: "/reports", label: "Reports", icon: PieChart },
];

export function AppSidebar({ email, role }: { email?: string | null; role?: string | null }) {
  const pathname = usePathname();

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex h-16 items-center px-5">
        <Image
          src="/vixus-logo.png"
          alt="Vixus Global Investments"
          width={132}
          height={46}
          priority
          unoptimized
        />
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={[
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                active
                  ? "bg-[#1f3a5f]/[0.06] font-medium text-[#1f3a5f]"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              ].join(" ")}
            >
              <Icon size={18} className={active ? "text-[#8DC63F]" : "text-slate-400"} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 p-3">
        <div className="mb-2 px-2">
          <div className="truncate text-sm font-medium text-slate-700">{email ?? "—"}</div>
          {role && <div className="text-xs text-slate-400">{role}</div>}
        </div>
        <form action={logout}>
          <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100">
            <LogOut size={18} className="text-slate-400" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
