import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { LoanDocExtraction, ExtractKind } from "@/lib/pools/loan-doc-analyze";

/**
 * Documentos do financiamento (mock aprovado 16/07): o documento propõe, o usuário revisa
 * e aplica. buildLoanDocProposal monta os itens (valor atual → novo + onde vai); nada é
 * aplicado às cegas, e os campos continuam editáveis nos forms depois (corrigir leitura).
 */

export type LoanDocProposalItem = {
  key: string;
  label: string;
  from: string | null; // valor atual formatado (null = vazio hoje)
  to: string; // valor proposto formatado
  target: string; // onde a aplicação escreve
  defaultOn: boolean; // pré-marcado no painel
  set:
    | { loan: Record<string, string | number> }
    | { bank: Record<string, number> }
    | { entry: { type: string; date: string; amount: number; memo: string; houseAddress?: string } };
};

const money0 = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const txt = (s: string) => (s.trim() ? s.trim() : null);

export function buildLoanDocProposal(
  ex: LoanDocExtraction,
  kind: ExtractKind,
  ctx: {
    fileName: string;
    loan: { closingDate: string | null; committed: number | null; aprPct: number | null; loanNumber: string | null };
    bank: { name: string; termMonths: number; extensionMonths: number } | null;
    housesBudget?: number | null; // Σ drawable das casas do loan (p/ sugerir a modalidade)
  },
): LoanDocProposalItem[] {
  const items: LoanDocProposalItem[] = [];
  const src = `«${ctx.fileName}» (AI)`;
  const anchorDate = txt(ex.closingDate) ?? txt(ex.docDate) ?? new Date().toISOString().slice(0, 10);

  if (txt(ex.closingDate)) {
    items.push({
      key: "closingDate",
      label: `Closing do loan (real): ${ex.closingDate}`,
      from: ctx.loan.closingDate,
      to: ex.closingDate,
      target: "→ Loan · prazos da Overview e estado do loan",
      defaultOn: true,
      set: { loan: { closingDate: ex.closingDate } },
    });
  }
  if (ex.committed > 0) {
    const same = ctx.loan.committed != null && Math.abs(ctx.loan.committed - ex.committed) < 1;
    items.push({
      key: "committed",
      label: `Committed: ${money0(ex.committed)}${same ? " (confere ✓)" : ""}`,
      from: ctx.loan.committed != null ? money0(ctx.loan.committed) : null,
      to: money0(ex.committed),
      target: "→ Loan",
      defaultOn: !same,
      set: { loan: { committed: ex.committed } },
    });
  }
  if (ex.interestRatePct > 0) {
    const same = ctx.loan.aprPct != null && Math.abs(ctx.loan.aprPct - ex.interestRatePct) < 0.001;
    items.push({
      key: "aprPct",
      label: `Taxa: ${ex.interestRatePct}% a.a.${same ? " (confere ✓)" : ""}`,
      from: ctx.loan.aprPct != null ? `${ctx.loan.aprPct}%` : null,
      to: `${ex.interestRatePct}%`,
      target: "→ Loan (conferência dos juros)",
      defaultOn: !same,
      set: { loan: { aprPct: ex.interestRatePct } },
    });
  }
  if (txt(ex.loanNumber) && ex.loanNumber.trim() !== (ctx.loan.loanNumber ?? "")) {
    items.push({
      key: "loanNumber",
      label: `Nº do loan: ${ex.loanNumber.trim()}`,
      from: ctx.loan.loanNumber,
      to: ex.loanNumber.trim(),
      target: "→ Loan",
      defaultOn: true,
      set: { loan: { loanNumber: ex.loanNumber.trim() } },
    });
  }
  if (ex.termMonths > 0 && ctx.bank) {
    const months = Math.round(ex.termMonths);
    items.push({
      key: "termMonths",
      label: `Prazo: ${months} meses${txt(ex.maturityDate) ? ` (maturity ${ex.maturityDate})` : ""}`,
      from: `${ctx.bank.termMonths} meses`,
      to: `${months} meses`,
      target: `→ perfil do banco (${ctx.bank.name})`,
      defaultOn: ctx.bank.termMonths !== months,
      set: { bank: { termMonths: months } },
    });
  }
  if (ex.extensionMonths > 0 && ctx.bank) {
    items.push({
      key: "extension",
      label: `Extensão: +${Math.round(ex.extensionMonths)}m${ex.extensionFeePct > 0 ? ` a ${ex.extensionFeePct}%` : ""}`,
      from: ctx.bank.extensionMonths > 0 ? `+${ctx.bank.extensionMonths}m` : null,
      to: `+${Math.round(ex.extensionMonths)}m`,
      target: `→ perfil do banco (${ctx.bank.name})`,
      defaultOn: true,
      set: {
        bank: {
          extensionMonths: Math.round(ex.extensionMonths),
          ...(ex.extensionFeePct > 0 ? { extensionFeePct: ex.extensionFeePct } : {}),
        },
      },
    });
  }
  // modalidade do envelope (17/07): a matemática entrega — teto ≈ Σ casas → fees POR
  // DENTRO (net funding); teto ≈ Σ casas + fees → POR FORA (gross-up). Sugestão revisável.
  if (ex.committed > 0 && ctx.housesBudget != null && ctx.housesBudget > 0) {
    const feesSum = ex.feesAtClosing.filter((f) => f.financed && f.amount > 0).reduce((s, f) => s + f.amount, 0);
    const tol = Math.max(1000, ex.committed * 0.01);
    const diff = ex.committed - ctx.housesBudget;
    const guess: "IN" | "OUT" | null =
      Math.abs(diff) <= tol ? "IN" : feesSum > 0 && Math.abs(diff - feesSum) <= Math.max(tol, feesSum * 0.25) ? "OUT" : null;
    if (guess) {
      items.push({
        key: "feesMode",
        label:
          guess === "IN"
            ? `Modalidade: fees POR DENTRO do teto (teto ${money0(ex.committed)} ≈ soma das casas ${money0(ctx.housesBudget)})`
            : `Modalidade: fees POR FORA (teto ${money0(ex.committed)} ≈ casas ${money0(ctx.housesBudget)} + fees ${money0(feesSum)})`,
        from: null,
        to: guess === "IN" ? "por dentro" : "por fora",
        target: "→ Loan · envelope, suficiência e disponibilidade de draws",
        defaultOn: true,
        set: { loan: { feesInEnvelope: guess } },
      });
    }
  }
  // vencimento dos juros (mock aprovado 17/07): dia + grace + multa → campos do loan
  if (ex.paymentDueDay > 0 && ex.paymentDueDay <= 31) {
    items.push({
      key: "dueDay",
      label: `Vencimento do juro: todo dia ${Math.round(ex.paymentDueDay)}${ex.graceDays > 0 ? ` (grace ${Math.round(ex.graceDays)}d)` : ""}${ex.lateChargePct > 0 ? ` · multa ${ex.lateChargePct}%` : ""}`,
      from: null,
      to: `dia ${Math.round(ex.paymentDueDay)}`,
      target: "→ Loan · tabela de juros do statement e menu Juros",
      defaultOn: true,
      set: {
        loan: {
          interestDueDay: Math.round(ex.paymentDueDay),
          ...(ex.graceDays > 0 ? { graceDays: Math.round(ex.graceDays) } : {}),
          ...(ex.lateChargePct > 0 ? { lateFeePct: ex.lateChargePct } : {}),
        },
      },
    });
  }
  // cash devolvido ao borrower no closing — COMPÕE o saldo inicial do banco junto com os
  // fees financiados (nunca somar cobranças por cima de um funded que já as embute)
  if (ex.cashToBorrower > 0) {
    items.push({
      key: "cashOut",
      label: `Crédito recebido no closing (cash to borrower): ${money0(ex.cashToBorrower)}`,
      from: null,
      to: money0(ex.cashToBorrower),
      target: "→ lançamento no statement (compõe o saldo inicial do banco)",
      defaultOn: true,
      set: { entry: { type: "OTHER", date: anchorDate, amount: ex.cashToBorrower, memo: `Crédito recebido no closing (cash-out) — ${src}` } },
    });
  }
  if (ex.interestReserveFinanced > 0) {
    items.push({
      key: "reserve",
      label: `Interest reserve financiada: ${money0(ex.interestReserveFinanced)}`,
      from: null,
      to: money0(ex.interestReserveFinanced),
      target: "→ lançamento RESERVE no statement",
      defaultOn: false, // capitaliza no saldo — confirmar antes
      set: { entry: { type: "RESERVE", date: anchorDate, amount: ex.interestReserveFinanced, memo: `Interest reserve — ${src}` } },
    });
  }
  ex.feesAtClosing.forEach((f, i) => {
    if (f.amount <= 0) return;
    const feeType = kind === "DRAW" ? "DRAW_FEE" : "CLOSING_FEE";
    items.push({
      key: `fee:${i}`,
      label: `${f.name}: ${money0(f.amount)}${f.financed ? "" : " (pago em caixa — confira antes de lançar no saldo)"}`,
      from: null,
      to: money0(f.amount),
      target: `→ lançamento ${feeType} no statement`,
      defaultOn: f.financed, // não-financiado não soma ao saldo do banco — desmarcado
      set: { entry: { type: feeType, date: kind === "DRAW" ? (txt(ex.drawDate) ?? anchorDate) : anchorDate, amount: f.amount, memo: `${f.name} — ${src}` } },
    });
  });
  if (kind === "DRAW" && ex.drawAmount > 0) {
    items.push({
      key: "draw",
      label: `Draw liberado: ${money0(ex.drawAmount)}${txt(ex.drawHouseAddress) ? ` (${ex.drawHouseAddress.trim()})` : ""}`,
      from: null,
      to: money0(ex.drawAmount),
      target: "→ lançamento DRAW no statement (vincula à casa)",
      defaultOn: true,
      set: {
        entry: {
          type: "DRAW",
          date: txt(ex.drawDate) ?? anchorDate,
          amount: ex.drawAmount,
          memo: `Liberação — ${src}`,
          ...(txt(ex.drawHouseAddress) ? { houseAddress: ex.drawHouseAddress.trim() } : {}),
        },
      },
    });
  }
  if (kind === "STATEMENT" && ex.interestAmount > 0) {
    items.push({
      key: "interest",
      label: `Juro do período${txt(ex.interestPeriodEnd) ? ` até ${ex.interestPeriodEnd}` : ""}: ${money0(ex.interestAmount)}`,
      from: null,
      to: money0(ex.interestAmount),
      target: "→ lançamento INTEREST (aba Juros do loan)",
      defaultOn: true,
      set: { entry: { type: "INTEREST", date: txt(ex.interestPeriodEnd) ?? anchorDate, amount: ex.interestAmount, memo: `Juro do mês — ${src}` } },
    });
  }
  return items;
}

// casa do draw pelo endereço: número da rua igual + alguma palavra da rua em comum
function matchHouse(
  address: string,
  houses: Array<{ id: string; address: string }>,
): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const a = norm(address);
  const aNum = a.match(/^\d+/)?.[0];
  const aWords = new Set(a.split(" ").filter((w) => w.length > 2 && !/^\d+$/.test(w)));
  let best: { id: string; score: number } | null = null;
  for (const h of houses) {
    const b = norm(h.address);
    const bNum = b.match(/^\d+/)?.[0];
    if (aNum && bNum && aNum !== bNum) continue;
    const shared = b.split(" ").filter((w) => aWords.has(w)).length;
    const score = (aNum && bNum && aNum === bNum ? 10 : 0) + shared;
    if (score > 0 && (!best || score > best.score)) best = { id: h.id, score };
  }
  return best?.id ?? null;
}

// Aplica os itens selecionados de um documento. Tudo continua editável depois — Termos do
// loan, perfil do banco e lançamentos do statement (apagar/relançar) corrigem qualquer leitura.
export async function applyLoanDocProposal(
  docId: string,
  selectedKeys: string[],
): Promise<{ applied: string[] } | { error: string }> {
  const doc = await prisma.poolLoanDocument.findUnique({
    where: { id: docId },
    include: { loan: { include: { bankProfile: true, pool: { include: { houses: true } } } } },
  });
  if (!doc?.proposal) return { error: "Documento sem proposta pendente." };
  const items = doc.proposal as unknown as LoanDocProposalItem[];
  const chosen = items.filter((i) => selectedKeys.includes(i.key));
  if (chosen.length === 0) return { error: "Selecione pelo menos um item (ou use Só arquivar)." };

  const loanData: Record<string, unknown> = {};
  const bankData: Record<string, unknown> = {};
  const entries: Array<{ type: string; date: string; amount: number; memo: string; houseAddress?: string }> = [];
  for (const it of chosen) {
    if ("loan" in it.set) {
      for (const [k, v] of Object.entries(it.set.loan))
        loanData[k] =
          k === "closingDate" ? new Date(String(v)) : k === "feesInEnvelope" ? v === "IN" : v;
    } else if ("bank" in it.set) {
      Object.assign(bankData, it.set.bank);
    } else {
      entries.push(it.set.entry);
    }
  }

  const houses = doc.loan.pool.houses.map((h) => ({ id: h.id, address: h.address }));
  await prisma.$transaction([
    ...(Object.keys(loanData).length > 0
      ? [prisma.poolLoan.update({ where: { id: doc.loanId }, data: loanData })]
      : []),
    ...(Object.keys(bankData).length > 0 && doc.loan.bankProfileId
      ? [prisma.bankProfile.update({ where: { id: doc.loan.bankProfileId }, data: bankData })]
      : []),
    ...entries.map((e) =>
      prisma.poolLoanEntry.create({
        data: {
          loanId: doc.loanId,
          houseId: e.houseAddress ? matchHouse(e.houseAddress, houses) : null,
          type: e.type as never,
          date: new Date(e.date),
          amount: Math.abs(e.amount),
          memo: e.memo,
        },
      }),
    ),
    prisma.poolLoanDocument.update({
      where: { id: doc.id },
      data: {
        proposal: Prisma.DbNull,
        appliedAt: new Date(),
        appliedSummary: chosen.map((c) => c.label.split(":")[0]).join(" · "),
      },
    }),
  ]);

  return { applied: chosen.map((c) => c.key) };
}
