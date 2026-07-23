import crypto from "crypto";

/**
 * #69 — Núcleo puro da conta de recebimento das distribuições (nada de Prisma aqui).
 * Máscara, hash das instruções bancárias (detecção de troca — BEC), payload do atesto
 * click-wrap e resolução de status. Reutilizado pela action do operador e pela do portal.
 */

export type PayoutStatus = "NONE" | "PENDING" | "CONFIRMED";

// Campos que, se mudarem, invalidam a confirmação (a "instrução de pagamento" em si).
export type PayoutKeyFields = {
  beneficiaryName: string;
  bankName: string;
  routingNumber: string | null;
  accountNumber: string;
  swift: string | null;
  iban: string | null;
};

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const clean = (s: string | null | undefined) => (s ?? "").trim();
// dígitos de routing/conta: tira espaços e traços (o usuário costuma digitar com separadores)
const digits = (s: string | null | undefined) => clean(s).replace(/[\s-]/g, "");

// Mostra só os últimos 4 (nunca expõe a conta inteira em telas/logs).
export function maskAccount(accountNumber: string | null | undefined): string {
  const d = digits(accountNumber);
  if (!d) return "—";
  return "••" + d.slice(-4);
}

// Rótulo curto "Banco ••1234" p/ tabelas do operador.
export function payoutLabel(bankName: string | null | undefined, accountNumber: string | null | undefined): string {
  const b = clean(bankName);
  const m = maskAccount(accountNumber);
  return b ? `${b} ${m}` : m;
}

// Hash SÓ das instruções bancárias — comparado ao keyHash guardado para saber se o sócio
// (ou o operador) trocou a instrução desde a última confirmação.
export function payoutKeyHash(f: PayoutKeyFields): string {
  const key = [
    clean(f.beneficiaryName).toLowerCase(),
    clean(f.bankName).toLowerCase(),
    digits(f.routingNumber),
    digits(f.accountNumber),
    clean(f.swift).toUpperCase(),
    digits(f.iban).toUpperCase(),
  ].join("|");
  return sha256(key);
}

// Payload assinado no atesto (trilha click-wrap, igual ao signHash da subscrição).
export function payoutConfirmHash(args: {
  key: PayoutKeyFields;
  entityKey: string; // c_<id> | p_<id>
  byEmail: string;
  at: Date; // passado de fora (server) — nunca new Date() implícito aqui
}): string {
  return sha256(
    [args.entityKey, payoutKeyHash(args.key), args.byEmail.trim().toLowerCase(), args.at.toISOString()].join("::"),
  );
}

export type PayoutValidation = { ok: true; normalized: PayoutKeyFields & { accountType: string | null; bankAddress: string | null } } | { ok: false; error: string };

// Validação mínima: beneficiário, banco e conta obrigatórios; e ou routing (doméstico) ou
// SWIFT (internacional). Não valida checksum de ABA/IBAN — é intencional (evita falso bloqueio).
export function validatePayout(raw: {
  beneficiaryName?: string | null;
  bankName?: string | null;
  routingNumber?: string | null;
  accountNumber?: string | null;
  accountType?: string | null;
  swift?: string | null;
  iban?: string | null;
  bankAddress?: string | null;
}): PayoutValidation {
  const beneficiaryName = clean(raw.beneficiaryName);
  const bankName = clean(raw.bankName);
  const routingNumber = digits(raw.routingNumber) || null;
  const accountNumber = digits(raw.accountNumber) || null;
  const swift = clean(raw.swift).toUpperCase() || null;
  const iban = digits(raw.iban).toUpperCase() || null;

  if (!beneficiaryName) return { ok: false, error: "Informe o titular da conta (beneficiário)." };
  if (!bankName) return { ok: false, error: "Informe o banco." };
  if (!accountNumber && !iban) return { ok: false, error: "Informe o número da conta (ou IBAN)." };
  if (!routingNumber && !swift && !iban)
    return { ok: false, error: "Informe o routing (ABA) para conta nos EUA, ou SWIFT/IBAN para internacional." };
  if (routingNumber && routingNumber.length !== 9)
    return { ok: false, error: "O routing (ABA) dos EUA tem 9 dígitos." };

  return {
    ok: true,
    normalized: {
      beneficiaryName,
      bankName,
      routingNumber,
      accountNumber: accountNumber ?? "",
      accountType: clean(raw.accountType) || null,
      swift,
      iban,
      bankAddress: clean(raw.bankAddress) || null,
    },
  };
}

// Status derivado do registro (ou da ausência dele).
export function payoutStatus(acc: { status: string; keyHash: string | null } | null): PayoutStatus {
  if (!acc) return "NONE";
  // segurança: se por algum motivo o keyHash ficou nulo mas o status diz CONFIRMED, trata como
  // pendente (nunca confirma sem trilha).
  if (acc.status === "CONFIRMED" && acc.keyHash) return "CONFIRMED";
  return "PENDING";
}

// Rótulos e cores (mesma linguagem visual do app: emerald/amber/slate).
export const PAYOUT_STATUS_META: Record<PayoutStatus, { label: string; tone: "ok" | "warn" | "none" }> = {
  CONFIRMED: { label: "Confirmada", tone: "ok" },
  PENDING: { label: "Pendente", tone: "warn" },
  NONE: { label: "Sem conta", tone: "none" },
};
