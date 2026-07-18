"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { INV_LANG_COOKIE, type Lang } from "@/lib/pools/i18n";

// Seletor EN | PT do módulo Investments (Fase 3): grava cookie e re-renderiza o server
// component. Datas NÃO mudam aqui — seguem o locale do Windows/navegador do usuário.
export function LangToggle({ lang }: { lang: Lang }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (l: Lang) => {
    document.cookie = `${INV_LANG_COOKIE}=${l};path=/;max-age=31536000;samesite=lax`;
    start(() => router.refresh());
  };
  return (
    <div
      className={`flex overflow-hidden rounded-full border border-slate-300 text-[11px] font-bold ${pending ? "opacity-60" : ""}`}
      title="Idioma do módulo Investments / Investments module language"
    >
      {(["en", "pt"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => set(l)}
          className={`px-3 py-1 uppercase transition ${
            lang === l ? "bg-[#1f3a5f] text-white" : "text-slate-400 hover:text-slate-600"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
