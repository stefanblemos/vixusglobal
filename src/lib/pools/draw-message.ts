// #draws — mensagem de solicitação de draw ao banco. Núcleo puro (sem Prisma): template
// padrão + preenchimento por tokens. O texto vive no banco (BankProfile.drawRequestTemplate,
// editável por credor); sem override, usa-se o DEFAULT. Em inglês (credores US).

export const DRAW_TEMPLATE_TOKENS = [
  "bank",
  "pool",
  "address",
  "pin",
  "lockbox",
  "drawNumber",
  "amount",
  "loanNumber",
] as const;

export type DrawTemplateTokens = Record<(typeof DRAW_TEMPLATE_TOKENS)[number], string>;

export const DEFAULT_DRAW_TEMPLATE = `Hi {bank},

Draw request — {pool} · Loan {loanNumber}
Property: {address}
Pin location: {pin}
Lockbox code: {lockbox}

We're requesting Draw #{drawNumber} in the amount of {amount} for the completed milestone. Please confirm receipt and the inspection schedule.

Thank you,
4U / Vixus`;

// Substitui {token} pelos valores; token desconhecido fica como está (não some texto do usuário).
export function fillDrawTemplate(template: string | null | undefined, t: DrawTemplateTokens): string {
  const src = template && template.trim() ? template : DEFAULT_DRAW_TEMPLATE;
  return src.replace(/\{(\w+)\}/g, (m, key: string) =>
    key in t ? (t[key as keyof DrawTemplateTokens] ?? "") : m,
  );
}
