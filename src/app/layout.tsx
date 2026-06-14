import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vixus Global — Control Platform",
  description: "Companies, ownership, ledger and loans — Vixus Global Investments",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
