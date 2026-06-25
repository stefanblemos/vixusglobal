"use client";

import { useEffect, useState } from "react";
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
  TrendingUp,
  Calculator,
  Activity,
  ListChecks,
  FolderOpen,
  PiggyBank,
  ClipboardCheck,
  CalendarClock,
  GitCompare,
  FileText,
  Boxes,
  Network,
  Settings,
  ShieldCheck,
  LogOut,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { logout } from "@/lib/actions/auth";

type Item = { href: string; label: string; icon: LucideIcon };
type Entry =
  | ({ type: "link" } & Item)
  | { type: "group"; label: string; icon: LucideIcon; items: Item[] };

// Menu agrupado por assunto. Itens soltos (Overview, Documents) ficam no topo/fim;
// os demais entram em grupos colapsáveis.
const NAV: Entry[] = [
  { type: "link", href: "/", label: "Overview", icon: LayoutDashboard },
  {
    type: "group",
    label: "Entities",
    icon: Building2,
    items: [
      { href: "/companies", label: "Companies", icon: Building2 },
      { href: "/parties", label: "Owners", icon: Users },
      { href: "/org-chart", label: "Org chart", icon: Network },
    ],
  },
  {
    type: "group",
    label: "Finance",
    icon: ArrowLeftRight,
    items: [
      { href: "/loans", label: "Loans", icon: ArrowLeftRight },
      { href: "/bank", label: "Bank", icon: Landmark },
      { href: "/ledger", label: "Ledger", icon: BookOpen },
      { href: "/faturamento", label: "Revenue & profit", icon: TrendingUp },
      { href: "/exposure", label: "Exposure", icon: Scale },
    ],
  },
  {
    type: "group",
    label: "Tax",
    icon: ReceiptText,
    items: [
      { href: "/tax", label: "Tax", icon: ReceiptText },
      { href: "/tax-preview", label: "Tax preview", icon: Calculator },
      { href: "/1099", label: "1099 worklist", icon: FileText },
      { href: "/assets", label: "Assets & depreciation", icon: Boxes },
      { href: "/reserve", label: "Tax reserve", icon: PiggyBank },
      { href: "/florida", label: "Florida tax", icon: Landmark },
      { href: "/tax-settings", label: "Tax settings", icon: Settings },
    ],
  },
  {
    type: "group",
    label: "Audit & Review",
    icon: ListChecks,
    items: [
      { href: "/closing", label: "Closing", icon: ClipboardCheck },
      { href: "/closing-sequence", label: "Closing sequence", icon: ListChecks },
      { href: "/obligations", label: "Obligations", icon: CalendarClock },
      { href: "/review", label: "Review", icon: ListChecks },
      { href: "/audit", label: "Audit", icon: Activity },
      { href: "/gl-check", label: "GL check", icon: GitCompare },
      { href: "/reports", label: "Reports", icon: PieChart },
    ],
  },
  { type: "link", href: "/import", label: "Documents", icon: FolderOpen },
];

export function AppSidebar({ email, role }: { email?: string | null; role?: string | null }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  // Grupo que contém a rota atual — sempre aberto.
  const activeGroup = NAV.find(
    (e): e is Extract<Entry, { type: "group" }> =>
      e.type === "group" && e.items.some((i) => isActive(i.href)),
  )?.label;

  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (activeGroup) setOpen((prev) => (prev.has(activeGroup) ? prev : new Set(prev).add(activeGroup)));
  }, [activeGroup]);

  const toggle = (label: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const linkClass = (active: boolean) =>
    [
      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
      active
        ? "bg-[#1f3a5f]/[0.06] font-medium text-[#1f3a5f]"
        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
    ].join(" ");

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Image
          src="/vixus-logo.png"
          alt="Vixus Global Investments"
          width={132}
          height={46}
          priority
          unoptimized
        />
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {NAV.map((entry) => {
          if (entry.type === "link") {
            const active = isActive(entry.href);
            const Icon = entry.icon;
            return (
              <Link key={entry.href} href={entry.href} className={linkClass(active)}>
                <Icon size={18} className={active ? "text-[#8DC63F]" : "text-slate-400"} />
                {entry.label}
              </Link>
            );
          }
          const Icon = entry.icon;
          const groupActive = entry.items.some((i) => isActive(i.href));
          const isOpen = open.has(entry.label);
          return (
            <div key={entry.label}>
              <button
                type="button"
                onClick={() => toggle(entry.label)}
                className={[
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                  groupActive ? "text-[#1f3a5f]" : "text-slate-600 hover:bg-slate-100",
                ].join(" ")}
              >
                <Icon size={18} className={groupActive ? "text-[#8DC63F]" : "text-slate-400"} />
                <span className="font-medium">{entry.label}</span>
                <ChevronDown
                  size={15}
                  className={`ml-auto text-slate-400 transition-transform ${isOpen ? "" : "-rotate-90"}`}
                />
              </button>
              {isOpen && (
                <div className="mt-0.5 space-y-0.5 pl-3">
                  {entry.items.map((i) => {
                    const active = isActive(i.href);
                    const SubIcon = i.icon;
                    return (
                      <Link key={i.href} href={i.href} className={linkClass(active)}>
                        <SubIcon size={16} className={active ? "text-[#8DC63F]" : "text-slate-400"} />
                        {i.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {role === "ADMIN" && (
          <Link href="/admin/users" className={linkClass(isActive("/admin/users"))}>
            <ShieldCheck
              size={18}
              className={isActive("/admin/users") ? "text-[#8DC63F]" : "text-slate-400"}
            />
            Users &amp; access
          </Link>
        )}
      </nav>

      <div className="shrink-0 border-t border-slate-200 p-3">
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
