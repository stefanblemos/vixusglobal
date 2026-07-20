"use client";

import { useEffect, useRef } from "react";

// Submete o formulário-pai automaticamente ao montar (consome o magic-link).
export function AutoSubmit() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.closest("form")?.requestSubmit();
  }, []);
  return <span ref={ref} aria-hidden />;
}
