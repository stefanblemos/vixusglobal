import { cookies } from "next/headers";

// Ano GLOBAL (cookie): setado uma vez no seletor da sidebar e usado como padrão por todas as telas
// fiscais. A URL (?year=) ainda vence, como override por página. Assim "seta o ano uma vez e vale em
// tudo" sem cada tela reimplementar seu próprio estado.
export const YEAR_COOKIE = "vixus_year";

export async function cookieYear(): Promise<number | null> {
  const c = (await cookies()).get(YEAR_COOKIE)?.value;
  return c && /^\d{4}$/.test(c) ? Number(c) : null;
}

// Ano "desejado" de uma página: ?year explícito na URL > cookie global > null (a página aplica o
// próprio fallback a partir dos anos que ela tem dados).
export async function resolveWanted(param?: string): Promise<number | null> {
  if (param && /^\d{4}$/.test(param)) return Number(param);
  return cookieYear();
}
