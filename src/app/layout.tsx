import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vixus Global — Plataforma de Controle",
  description: "Controle de empresas, ownership, ledger e empréstimos — Vixus Global Investments",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
