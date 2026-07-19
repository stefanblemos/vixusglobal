"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma, type PoolLoanEntryType } from "@prisma/client";
import { nextDrawNumber } from "@/lib/pools/draws";

export type FormState = { error?: string; ok?: boolean } | undefined;

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
};
const optNum = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const optDate = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s ? new Date(s) : null;
};

// status derivado: draws/payoffs mudam a fase da casa e do pool — recomputa nos writes
async function recompute(poolId: string) {
  const { recomputePoolStatuses } = await import("@/lib/pools/status-recompute");
  await recomputePoolStatuses(poolId);
}

// Tipos cujo valor REDUZ a dívida — o usuário digita positivo, o app aplica o sinal.
const NEGATIVE_TYPES = new Set(["INTEREST_PAYMENT", "PAYOFF", "CREDIT"]);

const ENTRY_TYPES = [
  "CLOSING_FEE",
  "RESERVE",
  "DRAW",
  "DRAW_FEE",
  "INTEREST",
  "INTEREST_PAYMENT",
  "PAYOFF",
  "RECONVEYANCE",
  "CREDIT",
  "OTHER",
] as const;

// Documentos do financiamento (mock aprovado 16/07): pasta POR LOAN dentro do pool. O
// documento é a FONTE — a IA extrai por tipo e propõe; o usuário revisa antes de aplicar.
// LOI mantém o pipeline direto (banco + loan); os demais tipos geram proposta revisável.
const DOC_KINDS = ["LOI", "AGREEMENT", "NOTE", "SETTLEMENT", "DRAW", "STATEMENT", "OTHER"] as const;

type LoanWithBank = NonNullable<
  Awaited<ReturnType<typeof prisma.poolLoan.findUnique<{ where: { id: string }; include: { bankProfile: true } }>>>
>;

// Núcleo do pipeline de UM documento com o tipo já resolvido. Uploads sempre ACRESCENTAM
// ao arquivo do loan (nunca substituem — pode haver LOI + contrato + note + extratos).
// docId presente = ajuste de tipo: relê o PDF guardado e ATUALIZA a mesma linha.
async function runLoanDocPipeline(opts: {
  poolId: string;
  loan: LoanWithBank;
  bytes: Buffer;
  fileName: string;
  kind: string;
  autoNote?: string | null; // nota da classificação automática (ex.: não identificado)
  docId?: string;
}): Promise<{ error: string } | { ok: true }> {
  const { poolId, loan, bytes, fileName, kind, autoNote, docId } = opts;
  const base = { loanId: loan.id, fileName, pdf: new Uint8Array(bytes), pdfSize: bytes.length };
  const upsertDoc = (data: Record<string, unknown>) =>
    docId
      ? prisma.poolLoanDocument.update({ where: { id: docId }, data })
      : prisma.poolLoanDocument.create({ data: { ...base, ...data } as never });

  if (kind === "OTHER") {
    await upsertDoc({
      kind: "OTHER",
      summary: autoNote ?? null,
      extracted: Prisma.DbNull,
      proposal: Prisma.DbNull,
      appliedAt: null,
      appliedSummary: null,
    });
    return { ok: true };
  }

  if (kind === "LOI") {
    // pipeline direto: condições → perfil do banco (do loan; sem banco = cria do LOI)
    const { applyLoiToBankProfile } = await import("@/lib/pools/loi-apply");
    const res = await applyLoiToBankProfile(bytes, fileName, loan.bankProfileId);
    if ("error" in res) return { error: res.error };
    const { bank, ex, matchedTarget } = res;
    // credor do LOI ≠ banco deste loan → aplica no loan DO CREDOR (existente no pool, ou
    // criado agora); o loan original fica intacto (bug PH-4: RBI/2BTrust por cima da FCI)
    let target = loan;
    let createdNewLoan = false;
    if (!matchedTarget) {
      const sibling = await prisma.poolLoan.findFirst({
        where: { poolId, bankProfileId: bank.id },
        include: { bankProfile: true },
      });
      if (sibling) target = sibling;
      else {
        target = await prisma.poolLoan.create({
          data: { poolId, bankProfileId: bank.id },
          include: { bankProfile: true },
        });
        createdNewLoan = true;
      }
    }
    const noteBits = `LOI ${ex.loiNumber.trim() || fileName}${ex.loiDate.trim() ? ` de ${ex.loiDate.trim()}` : ""} lido por AI — ${ex.summary}`;
    await prisma.$transaction([
      prisma.poolLoan.update({
        where: { id: target.id },
        data: {
          bankProfileId: bank.id,
          ...(ex.totalLoanAmount > 0 ? { committed: ex.totalLoanAmount } : {}),
          ...(ex.interestRatePct > 0 ? { aprPct: ex.interestRatePct } : {}),
          ...(ex.loiNumber.trim() ? { loanNumber: ex.loiNumber.trim() } : {}),
          // a data do LOI abre a fase de CONTRATAÇÃO do loan no Cronograma (celeridade
          // do banco = LOI → closing); só preenche se ainda vazio (editável nos Termos)
          ...(ex.loiDate.trim() && !target.firstContactDate
            ? { firstContactDate: new Date(ex.loiDate.trim()) }
            : {}),
          notes: [target.notes, noteBits].filter(Boolean).join(" · "),
        },
      }),
      upsertDoc({
        loanId: target.id,
        kind: "LOI",
        summary: ex.summary,
        extracted: JSON.parse(JSON.stringify(ex)),
        proposal: Prisma.DbNull,
        appliedAt: new Date(),
        appliedSummary: createdNewLoan
          ? `credor ${bank.name} ≠ banco do loan — loan novo criado no pool + condições aplicadas`
          : `condições aplicadas ao banco (${bank.name}) + loan`,
      }),
    ]);
    return { ok: true };
  }

  // demais tipos: extrai e gera PROPOSTA revisável (nada aplicado às cegas)
  const { analyzeLoanDocPdf } = await import("@/lib/pools/loan-doc-analyze");
  const { buildLoanDocProposal } = await import("@/lib/pools/loan-doc-apply");
  let ex;
  try {
    ex = await analyzeLoanDocPdf(bytes.toString("base64"), kind as never);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha na extração do documento." };
  }
  const housesBudgetAgg = await prisma.poolHouse.aggregate({
    where: { loanId: loan.id },
    _sum: { bankLoanAmount: true },
  });
  const proposal = buildLoanDocProposal(ex, kind as never, {
    fileName,
    loan: {
      closingDate: loan.closingDate ? loan.closingDate.toISOString().slice(0, 10) : null,
      committed: loan.committed != null ? Number(loan.committed) : null,
      aprPct: loan.aprPct != null ? Number(loan.aprPct) : null,
      loanNumber: loan.loanNumber,
    },
    bank: loan.bankProfile
      ? {
          name: loan.bankProfile.name,
          termMonths: loan.bankProfile.termMonths,
          extensionMonths: loan.bankProfile.extensionMonths,
        }
      : null,
    housesBudget:
      housesBudgetAgg._sum.bankLoanAmount != null ? Number(housesBudgetAgg._sum.bankLoanAmount) : null,
  });
  await upsertDoc({
    kind: kind as never,
    summary: [autoNote, ex.summary || null].filter(Boolean).join(" · ") || null,
    extracted: JSON.parse(JSON.stringify(ex)),
    proposal: proposal.length > 0 ? JSON.parse(JSON.stringify(proposal)) : Prisma.DbNull,
    appliedAt: null,
    appliedSummary: proposal.length === 0 ? "nada a aplicar — só arquivado" : null,
  });
  return { ok: true };
}

export async function uploadLoanDocument(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // MULTI-upload (17/07): vários PDFs num lote — todos ACRESCENTAM ao arquivo do loan
  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "Escolha o(s) PDF(s) do(s) documento(s)." };
  if (files.length > 6) return { error: "Máximo de 6 documentos por lote." };
  for (const f of files) if (f.size > 10 * 1024 * 1024) return { error: `${f.name}: PDF acima de 10MB.` };
  const kindSel = String(formData.get("kind") ?? "AUTO");
  if (kindSel !== "AUTO" && !DOC_KINDS.includes(kindSel as (typeof DOC_KINDS)[number]))
    return { error: "Escolha o tipo do documento." };
  const loanId = String(formData.get("loanId") ?? "").trim();
  const loan = await prisma.poolLoan.findUnique({ where: { id: loanId }, include: { bankProfile: true } });
  if (!loan || loan.poolId !== poolId) return { error: "Loan não encontrado neste pool." };

  const results = await Promise.all(
    files.map(async (file): Promise<string | null> => {
      try {
        const bytes = Buffer.from(await file.arrayBuffer());
        let kind = kindSel;
        let autoNote: string | null = null;
        if (kindSel === "AUTO") {
          // a LEITURA diz o que é o documento; sem certeza → arquiva p/ o usuário ajustar
          try {
            const { classifyLoanDocPdf } = await import("@/lib/pools/loan-doc-analyze");
            const guess = await classifyLoanDocPdf(bytes.toString("base64"));
            if (guess.confidence === "HIGH" && guess.kind !== "OTHER") kind = guess.kind;
            else {
              kind = "OTHER";
              autoNote = `tipo não identificado pela leitura${guess.reason ? ` (${guess.reason})` : ""} — ajuste ao lado`;
            }
          } catch {
            kind = "OTHER";
            autoNote = "classificação automática falhou — ajuste o tipo ao lado";
          }
        }
        const r = await runLoanDocPipeline({ poolId, loan, bytes, fileName: file.name, kind, autoNote });
        return "error" in r ? `${file.name}: ${r.error}` : null;
      } catch (e) {
        return `${file.name}: ${e instanceof Error ? e.message : "falha no processamento"}`;
      }
    }),
  );
  revalidatePath(`/pools/${poolId}/loan`);
  const errors = results.filter((r): r is string => r != null);
  if (errors.length > 0)
    return {
      error: `${errors.join(" · ")}${files.length > errors.length ? " — os demais entraram no arquivo" : ""}`,
    };
  return { ok: true };
}

// Ajuste de tipo (17/07): quando a classificação erra ou não identifica, o select relê o
// PDF guardado com o tipo escolhido e atualiza a MESMA linha do arquivo.
export async function reclassifyLoanDoc(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const docId = String(formData.get("docId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!DOC_KINDS.includes(kind as (typeof DOC_KINDS)[number])) return { error: "Tipo inválido." };
  const doc = await prisma.poolLoanDocument.findUnique({
    where: { id: docId },
    include: { loan: { include: { bankProfile: true } } },
  });
  if (!doc || doc.loan.poolId !== poolId) return { error: "Documento não encontrado." };
  const r = await runLoanDocPipeline({
    poolId,
    loan: doc.loan,
    bytes: Buffer.from(doc.pdf),
    fileName: doc.fileName,
    kind,
    docId: doc.id,
  });
  revalidatePath(`/pools/${poolId}/loan`);
  return "error" in r ? { error: r.error } : { ok: true };
}

// Aplica os itens selecionados da proposta de um documento (checkbox por campo).
export async function applyLoanDoc(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const docId = String(formData.get("docId") ?? "");
  const keys = formData.getAll("keys").map(String);
  const { applyLoanDocProposal } = await import("@/lib/pools/loan-doc-apply");
  const res = await applyLoanDocProposal(docId, keys);
  if ("error" in res) return { error: res.error };
  await recompute(poolId);
  revalidatePath(`/pools/${poolId}/loan`);
  revalidatePath(`/pools/${poolId}`); // prazos/estado na Overview e Juros
  return { ok: true };
}

// "Só arquivar": descarta a proposta e guarda o documento como fonte.
export async function archiveLoanDoc(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const docId = String(formData.get("docId") ?? "");
  const doc = await prisma.poolLoanDocument.findUnique({ where: { id: docId } });
  if (!doc) return { error: "Documento não encontrado." };
  const { Prisma } = await import("@prisma/client");
  await prisma.poolLoanDocument.update({
    where: { id: docId },
    data: { proposal: Prisma.DbNull, appliedSummary: doc.appliedSummary ?? "arquivado sem aplicar" },
  });
  revalidatePath(`/pools/${poolId}/loan`);
  return { ok: true };
}

export async function deleteLoanDoc(formData: FormData): Promise<void> {
  const docId = String(formData.get("docId") ?? "");
  const poolId = String(formData.get("poolId") ?? "");
  if (docId) await prisma.poolLoanDocument.delete({ where: { id: docId } });
  if (poolId) revalidatePath(`/pools/${poolId}/loan`);
}

// Vincula uma casa a um loan/banco deste pool (ou "" = 100% equity). Decide para onde vai
// o draw, qual contrato de fees se aplica e onde entra o payoff. bankName da casa (usado
// nas fichas/relatórios) acompanha o banco do loan.
export async function assignHouseLoan(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const houseId = String(formData.get("houseId") ?? "");
  const loanId = String(formData.get("loanId") ?? "").trim() || null;
  const house = await prisma.poolHouse.findUnique({ where: { id: houseId } });
  if (!house || house.poolId !== poolId) return { error: "Casa não encontrada neste pool." };
  let bankName: string | null = null;
  if (loanId) {
    const loan = await prisma.poolLoan.findUnique({
      where: { id: loanId },
      include: { bankProfile: { select: { name: true } } },
    });
    if (!loan || loan.poolId !== poolId) return { error: "Loan não encontrado neste pool." };
    bankName = loan.bankProfile?.name ?? null;
  }
  await prisma.poolHouse.update({ where: { id: houseId }, data: { loanId, bankName } });
  revalidatePath(`/pools/${poolId}/loan`);
  revalidatePath(`/pools/${poolId}`);
  return { ok: true };
}

// Resolve um loan do pool: id explícito > único loan existente. Null se ambíguo.
async function resolveLoan(poolId: string, loanId: string | null) {
  if (loanId) {
    const loan = await prisma.poolLoan.findUnique({ where: { id: loanId } });
    return loan?.poolId === poolId ? loan : null;
  }
  const loans = await prisma.poolLoan.findMany({ where: { poolId }, take: 2 });
  return loans.length === 1 ? loans[0] : null;
}

// Cria/edita um construction loan do pool (termos). Sem loanId no form = cria um novo
// (um pool pode ter vários bancos, cada um financiando um grupo de casas).
export async function savePoolLoan(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const loanId = String(formData.get("loanId") ?? "").trim() || null;
  const data = {
    bankProfileId: String(formData.get("bankProfileId") ?? "").trim() || null,
    loanNumber: String(formData.get("loanNumber") ?? "").trim() || null,
    committed: optNum(formData.get("committed")),
    aprPct: optNum(formData.get("aprPct")),
    // solicitação do LOI — abre a fase de contratação do loan no Cronograma
    firstContactDate: optDate(formData.get("firstContactDate")),
    expectedClosingDate: optDate(formData.get("expectedClosingDate")),
    closingDate: optDate(formData.get("closingDate")),
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
  if (loanId) {
    const loan = await prisma.poolLoan.findUnique({ where: { id: loanId } });
    if (!loan || loan.poolId !== poolId) return { error: "Loan not found." };
    await prisma.poolLoan.update({ where: { id: loanId }, data });
  } else {
    await prisma.poolLoan.create({ data: { poolId, ...data } });
  }
  revalidatePath(`/pools/${poolId}/loan`);
  return { ok: true };
}

// Remove um loan criado por engano — só sem lançamentos; as casas voltam a "sem loan".
export async function deletePoolLoan(formData: FormData): Promise<void> {
  const loanId = String(formData.get("loanId") ?? "");
  const poolId = String(formData.get("poolId") ?? "");
  if (!loanId) return;
  const entries = await prisma.poolLoanEntry.count({ where: { loanId } });
  if (entries > 0) return;
  await prisma.poolLoan.delete({ where: { id: loanId } });
  if (poolId) revalidatePath(`/pools/${poolId}/loan`);
}

export async function addLoanEntry(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const loan = await resolveLoan(poolId, String(formData.get("loanId") ?? "").trim() || null);
  if (!loan) return { error: "Set up the loan terms first." };

  const type = String(formData.get("type") ?? "");
  if (!ENTRY_TYPES.includes(type as (typeof ENTRY_TYPES)[number]))
    return { error: "Pick the entry type." };
  const dateRaw = String(formData.get("date") ?? "").trim();
  if (!dateRaw) return { error: "Date is required." };
  const raw = num(formData.get("amount"));
  if (!Number.isFinite(raw) || raw === 0) return { error: "Amount must be a non-zero number." };

  // sinal automático: usuário digita positivo; payoff/pagamento/crédito reduzem a dívida
  const amount = NEGATIVE_TYPES.has(type) ? -Math.abs(raw) : Math.abs(raw);
  const houseId = String(formData.get("houseId") ?? "").trim() || null;

  await prisma.poolLoanEntry.create({
    data: {
      loanId: loan.id,
      houseId,
      type: type as PoolLoanEntryType,
      date: new Date(dateRaw),
      amount,
      memo: String(formData.get("memo") ?? "").trim() || null,
    },
  });
  revalidatePath(`/pools/${poolId}/loan`);
  return undefined;
}

export async function deleteLoanEntry(formData: FormData): Promise<void> {
  const id = String(formData.get("entryId") ?? "");
  const poolId = String(formData.get("poolId") ?? "");
  if (id) await prisma.poolLoanEntry.delete({ where: { id } });
  if (poolId) await recompute(poolId);
  if (poolId) revalidatePath(`/pools/${poolId}/loan`);
}

// Concilia/desconcilia uma linha contra o extrato do banco.
export async function toggleLoanEntryReconciled(formData: FormData): Promise<void> {
  const id = String(formData.get("entryId") ?? "");
  const poolId = String(formData.get("poolId") ?? "");
  if (!id) return;
  const entry = await prisma.poolLoanEntry.findUnique({ where: { id } });
  if (!entry) return;
  await prisma.poolLoanEntry.update({ where: { id }, data: { reconciled: !entry.reconciled } });
  if (poolId) revalidatePath(`/pools/${poolId}/loan`);
  revalidatePath("/pools/draws");
}

// Fees PREVISTOS do contrato do banco para um draw creditado (processing + inspection por
// draw; ACH uma vez por data de lote; customs PER_DRAW) — não-conciliados até o extrato.
async function predictedDrawFees(
  loanId: string,
  bank: {
    drawProcessingFee: unknown;
    inspectionFeePerDraw: unknown;
    achFeePerBatch: unknown;
    customFees: Array<{ timing: string; kind: string; amount: unknown; name: string }>;
  } | null,
  creditDate: Date,
  excludeEntryId?: string,
): Promise<Array<{ amount: number; memo: string }>> {
  if (!bank) return [];
  const fees: Array<{ amount: number; memo: string }> = [];
  if (Number(bank.drawProcessingFee) > 0)
    fees.push({ amount: Number(bank.drawProcessingFee), memo: "Draw processing fee (previsto — contrato)" });
  if (Number(bank.inspectionFeePerDraw) > 0)
    fees.push({ amount: Number(bank.inspectionFeePerDraw), memo: "Inspection fee (previsto — contrato)" });
  const drawsSameDay = await prisma.poolLoanEntry.count({
    where: {
      loanId,
      type: "DRAW",
      date: creditDate,
      pending: false,
      ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}),
    },
  });
  if (drawsSameDay === 0 && Number(bank.achFeePerBatch) > 0)
    fees.push({ amount: Number(bank.achFeePerBatch), memo: "ACH fee (previsto — contrato, por lote)" });
  for (const f of bank.customFees.filter((cf) => cf.timing === "PER_DRAW" && cf.kind === "FLAT"))
    fees.push({ amount: Number(f.amount), memo: `${f.name} (previsto — contrato)` });
  return fees;
}

// Lança um DRAW (tela global de Draws). Fluxo real: a SOLICITAÇÃO é salva primeiro
// (pendente — não entra no saldo); a resposta do banco vem depois e é registrada pela
// edição (aí entra no saldo com os fees previstos). Se liberação já é conhecida, entra
// direto creditado.
export async function addDraw(_prev: FormState, formData: FormData): Promise<FormState> {
  const poolId = String(formData.get("poolId") ?? "");
  const houseId = String(formData.get("houseId") ?? "").trim() || null;
  const creditDateRaw = String(formData.get("creditDate") ?? "").trim();
  const requestDateRaw = String(formData.get("requestDate") ?? "").trim();
  const released = optNum(formData.get("releasedAmount"));
  const requested = optNum(formData.get("requestedAmount"));
  if (!poolId) return { error: "Pick the pool." };
  if (released == null && requested == null)
    return { error: "Informe o valor solicitado (pedido pendente) ou o liberado (creditado)." };
  if (requested != null && !requestDateRaw && released == null)
    return { error: "Informe a data da solicitação." };
  if (released != null && !creditDateRaw)
    return { error: "Informe a data do crédito para o valor liberado." };

  // Loan alvo: explícito (tela é por loan) > loan da casa > único loan do pool
  const explicitLoanId = String(formData.get("loanId") ?? "").trim() || null;
  let targetLoanId = explicitLoanId;
  if (!targetLoanId && houseId) {
    const house = await prisma.poolHouse.findUnique({ where: { id: houseId }, select: { loanId: true } });
    targetLoanId = house?.loanId ?? null;
  }
  const resolved = await resolveLoan(poolId, targetLoanId);
  if (!resolved)
    return { error: "This pool has no loan yet — set it up in the Loan statement tab." };
  const loan = await prisma.poolLoan.findUnique({
    where: { id: resolved.id },
    include: { bankProfile: { include: { customFees: true } } },
  });
  if (!loan) return { error: "Loan not found." };
  const memo = String(formData.get("memo") ?? "").trim() || null;

  const drawNumber = await nextDrawNumber(loan.id);
  if (released == null) {
    // SOLICITAÇÃO pendente: não afeta o saldo; sem fees até a liberação
    await prisma.poolLoanEntry.create({
      data: {
        loanId: loan.id,
        houseId,
        type: "DRAW",
        pending: true,
        drawStatus: "REQUESTED",
        drawNumber,
        date: new Date(requestDateRaw),
        amount: 0,
        requestedAmount: Math.abs(requested!),
        requestDate: new Date(requestDateRaw),
        memo,
      },
    });
  } else {
    const creditDate = new Date(creditDateRaw);
    const fees = await predictedDrawFees(loan.id, loan.bankProfile, creditDate);
    await prisma.$transaction([
      prisma.poolLoanEntry.create({
        data: {
          loanId: loan.id,
          houseId,
          type: "DRAW",
          drawStatus: "APPROVED",
          drawNumber,
          date: creditDate,
          amount: Math.abs(released),
          requestedAmount: requested,
          requestDate: requestDateRaw ? new Date(requestDateRaw) : null,
          memo,
        },
      }),
      ...fees.map((f) =>
        prisma.poolLoanEntry.create({
          data: { loanId: loan.id, houseId, type: "DRAW_FEE", date: creditDate, amount: f.amount, memo: f.memo },
        }),
      ),
    ]);
  }
  await recompute(poolId);
  revalidatePath(`/pools/${poolId}/loan`);
  revalidatePath("/pools/draws");
  return { ok: true };
}

// Edita um draw. Pendente + valor liberado informado = REGISTRA A LIBERAÇÃO: entra no
// saldo na data do crédito e gera os fees previstos do contrato.
export async function editDraw(_prev: FormState, formData: FormData): Promise<FormState> {
  const entryId = String(formData.get("entryId") ?? "");
  if (!entryId) return { error: "Draw not found." };
  const entry = await prisma.poolLoanEntry.findUnique({
    where: { id: entryId },
    include: { loan: { include: { bankProfile: { include: { customFees: true } } } } },
  });
  if (!entry || entry.type !== "DRAW") return { error: "Draw not found." };

  const requested = optNum(formData.get("requestedAmount"));
  const requestDateRaw = String(formData.get("requestDate") ?? "").trim();
  const released = optNum(formData.get("releasedAmount"));
  const creditedNet = optNum(formData.get("creditedAmount")); // o que CAIU na conta
  const creditDateRaw = String(formData.get("creditDate") ?? "").trim();
  const houseId = String(formData.get("houseId") ?? "").trim() || null;
  const memo = String(formData.get("memo") ?? "").trim() || null;

  const releasing = entry.pending && released != null;
  if (releasing && !creditDateRaw) return { error: "Informe a data do crédito." };
  if (!entry.pending && released != null && released <= 0)
    return { error: "Released amount must be greater than 0." };

  const creditDate = creditDateRaw ? new Date(creditDateRaw) : entry.date;
  const fees = releasing
    ? await predictedDrawFees(entry.loanId, entry.loan.bankProfile, creditDate, entry.id)
    : [];
  // Banco depositou o LÍQUIDO? aprovado − creditado = fees retidos na fonte → lançamento
  // automático de DRAW_FEE na casa da inspeção (17/07 — "como saber se cobraram do draw")
  if (releasing && creditedNet != null && released != null && creditedNet < released - 0.01) {
    fees.push({
      amount: released - creditedNet,
      memo: `Fees retidos na fonte (aprovado ${released.toFixed(2)} − creditado ${creditedNet.toFixed(2)})`,
    });
  }

  await prisma.$transaction([
    prisma.poolLoanEntry.update({
      where: { id: entry.id },
      data: {
        houseId,
        requestedAmount: requested,
        requestDate: requestDateRaw ? new Date(requestDateRaw) : entry.requestDate,
        ...(released != null
          ? { amount: Math.abs(released), date: creditDate, pending: false, drawStatus: "APPROVED" }
          : {}),
        memo,
      },
    }),
    ...fees.map((f) =>
      prisma.poolLoanEntry.create({
        data: {
          loanId: entry.loanId,
          houseId: houseId ?? entry.houseId,
          type: "DRAW_FEE",
          date: creditDate,
          amount: f.amount,
          memo: f.memo,
        },
      }),
    ),
  ]);
  await recompute(entry.loan.poolId);
  revalidatePath(`/pools/${entry.loan.poolId}/loan`);
  revalidatePath("/pools/draws");
  return { ok: true };
}

// Nega ou cancela um draw solicitado. Fica na trilha (amount 0, não entra no saldo),
// com o motivo. DENIED = banco recusou; CANCELLED = nós desistimos.
export async function resolveDrawOutcome(formData: FormData): Promise<void> {
  const entryId = String(formData.get("entryId") ?? "");
  const outcome = String(formData.get("outcome") ?? "DENIED") === "CANCELLED" ? "CANCELLED" : "DENIED";
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!entryId) return;
  const entry = await prisma.poolLoanEntry.findUnique({
    where: { id: entryId },
    include: { loan: { select: { poolId: true } } },
  });
  if (!entry || entry.type !== "DRAW" || !entry.pending) return; // só draws pendentes
  await prisma.poolLoanEntry.update({
    where: { id: entryId },
    data: { pending: false, amount: 0, drawStatus: outcome, denyReason: reason },
  });
  const { logInvestmentAudit } = await import("@/lib/audit");
  await logInvestmentAudit({
    poolId: entry.loan.poolId,
    entity: "HOUSE",
    entityId: entry.houseId,
    action: "UPDATE",
    summary: `Draw #${entry.drawNumber ?? "?"} ${outcome === "DENIED" ? "negado pelo banco" : "cancelado"}${reason ? ` — ${reason}` : ""}`,
  });
  revalidatePath(`/pools/${entry.loan.poolId}/loan`);
  revalidatePath("/pools/draws");
}

// Lança o juro REAL do mês (aba Juros do loan): cria INTEREST e, se "pago da reserve",
// o INTEREST_PAYMENT espelhado na mesma data (padrão Builders Capital — saldo não compõe).
export async function addMonthlyInterest(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const loan = await resolveLoan(poolId, String(formData.get("loanId") ?? "").trim() || null);
  if (!loan) return { error: "Set up the loan terms first." };
  const dateRaw = String(formData.get("date") ?? "").trim();
  if (!dateRaw) return { error: "Date is required." };
  const raw = num(formData.get("amount"));
  if (!Number.isFinite(raw) || raw <= 0) return { error: "Amount must be greater than 0." };
  const fromReserve = formData.get("fromReserve") === "on";
  const memo = String(formData.get("memo") ?? "").trim() || null;

  await prisma.$transaction([
    prisma.poolLoanEntry.create({
      data: { loanId: loan.id, type: "INTEREST", date: new Date(dateRaw), amount: Math.abs(raw), memo },
    }),
    ...(fromReserve
      ? [
          prisma.poolLoanEntry.create({
            data: {
              loanId: loan.id,
              type: "INTEREST_PAYMENT",
              date: new Date(dateRaw),
              amount: -Math.abs(raw),
              memo: "Pago da interest reserve",
            },
          }),
        ]
      : []),
  ]);
  revalidatePath(`/pools/${poolId}`);
  revalidatePath(`/pools/${poolId}/loan`);
  revalidatePath(`/pools/interest`);
  return { ok: true };
}

// Gera o PAYOFF (e reconveyance, se o banco cobra) a partir dos dados de venda da casa —
// evita digitar duas vezes o que já está na ficha da casa.
export async function generatePayoffFromHouse(formData: FormData): Promise<void> {
  const poolId = String(formData.get("poolId") ?? "");
  const houseId = String(formData.get("houseId") ?? "");
  if (!poolId || !houseId) return;
  const house = await prisma.poolHouse.findUnique({ where: { id: houseId } });
  if (!house || house.payoffAmount == null || house.saleDate == null) return;
  // payoff vai para o loan DA CASA (pool pode ter vários bancos)
  const target = await resolveLoan(poolId, house.loanId);
  if (!target) return;
  const loan = await prisma.poolLoan.findUnique({
    where: { id: target.id },
    include: { bankProfile: true },
  });
  if (!loan) return;

  const exists = await prisma.poolLoanEntry.findFirst({
    where: { loanId: loan.id, houseId, type: "PAYOFF" },
  });
  if (exists) return; // já lançado

  const reconveyance = Number(loan.bankProfile?.reconveyanceFee ?? 0);
  await prisma.$transaction([
    ...(reconveyance > 0
      ? [
          prisma.poolLoanEntry.create({
            data: {
              loanId: loan.id,
              houseId,
              type: "RECONVEYANCE",
              date: house.saleDate,
              amount: reconveyance,
              memo: "Gerado da venda da casa",
            },
          }),
        ]
      : []),
    prisma.poolLoanEntry.create({
      data: {
        loanId: loan.id,
        houseId,
        type: "PAYOFF",
        date: house.saleDate,
        amount: -Math.abs(Number(house.payoffAmount)),
        memo: "Gerado da venda da casa",
      },
    }),
  ]);
  await recompute(poolId);
  revalidatePath(`/pools/${poolId}/loan`);
}

// ── Termos travados + Casas do loan (mock aprovado 17/07) ─────────────────────────────

// Salva os termos completos: campos do LOAN + condições do BANCO (perfil) numa tela só.
// Editar as condições atualiza o PERFIL do banco — vale p/ simulações e outros pools
// (decisão validada no mock). Campos vazios no form viram null (loan) / ficam como estão (banco).
export async function saveLoanTermsFull(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const loanId = String(formData.get("loanId") ?? "").trim();
  const loan = await prisma.poolLoan.findUnique({ where: { id: loanId } });
  if (!loan || loan.poolId !== poolId) return { error: "Loan não encontrado." };

  const bankProfileId = String(formData.get("bankProfileId") ?? "").trim() || null;
  await prisma.poolLoan.update({
    where: { id: loanId },
    data: {
      bankProfileId,
      loanNumber: String(formData.get("loanNumber") ?? "").trim() || null,
      committed: optNum(formData.get("committed")),
      aprPct: optNum(formData.get("aprPct")),
      firstContactDate: optDate(formData.get("firstContactDate")),
      expectedClosingDate: optDate(formData.get("expectedClosingDate")),
      closingDate: optDate(formData.get("closingDate")),
      // vencimento do juro mensal (tabela de juros do statement e menu Juros)
      interestDueDay: (() => {
        const v = optNum(formData.get("interestDueDay"));
        return v != null ? Math.min(31, Math.max(1, Math.round(v))) : null;
      })(),
      graceDays: (() => {
        const v = optNum(formData.get("graceDays"));
        return v != null ? Math.max(0, Math.round(v)) : null;
      })(),
      lateFeePct: optNum(formData.get("lateFeePct")),
      // modalidade do envelope: IN = fees por dentro do teto; OUT = por fora; "" = indefinida
      feesInEnvelope: (() => {
        const v = String(formData.get("feesInEnvelope") ?? "");
        return v === "IN" ? true : v === "OUT" ? false : null;
      })(),
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });

  // condições do banco: só aplica o que veio preenchido (não zera por campo vazio)
  if (bankProfileId) {
    const bnum = (name: string) => optNum(formData.get(name));
    const bankData: Record<string, unknown> = {};
    const map: Array<[string, string]> = [
      ["ltcBuildPct", "bankLtc"],
      ["ltvPct", "bankLtv"],
      ["originationPct", "bankOrigination"],
      ["brokerPct", "bankBroker"],
      ["processingFee", "bankProcessing"],
      ["appraisalFee", "bankAppraisal"],
      ["legalFee", "bankLegal"],
      ["budgetReviewFee", "bankFeasibility"],
      ["inspectionFeePerDraw", "bankDrawFee"],
      ["reserveMonths", "bankReserveMonths"],
    ];
    for (const [field, input] of map) {
      const v = bnum(input);
      if (v != null) bankData[field] = v;
    }
    const term = bnum("bankTermMonths");
    if (term != null) bankData.termMonths = Math.round(term);
    const ext = bnum("bankExtensionMonths");
    if (ext != null) bankData.extensionMonths = Math.round(ext);
    if (formData.has("bankFeesFinancedSent"))
      bankData.feesFinanced = formData.get("bankFeesFinanced") === "on";
    if (Object.keys(bankData).length > 0)
      await prisma.bankProfile.update({ where: { id: bankProfileId }, data: bankData });
  }

  revalidatePath(`/pools/${poolId}/loan`);
  return { ok: true };
}

// Vincula ao loan as casas selecionadas no modal — SÓ casas ainda sem loan apontado.
export async function linkHousesToLoan(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const loanId = String(formData.get("loanId") ?? "").trim();
  const loan = await prisma.poolLoan.findUnique({
    where: { id: loanId },
    include: { bankProfile: { select: { name: true } } },
  });
  if (!loan || loan.poolId !== poolId) return { error: "Loan não encontrado." };
  const houseIds = formData.getAll("houseIds").map(String).filter(Boolean);
  if (houseIds.length === 0) return { error: "Selecione ao menos uma casa." };
  const { count } = await prisma.poolHouse.updateMany({
    where: { id: { in: houseIds }, poolId, loanId: null },
    data: { loanId: loan.id, ...(loan.bankProfile ? { bankName: loan.bankProfile.name } : {}) },
  });
  if (count === 0) return { error: "Nenhuma casa vinculada — já tinham banco?" };
  revalidatePath(`/pools/${poolId}/loan`);
  return { ok: true };
}

// Desvincula a casa do loan (volta a "sem banco" — pode ser vinculada a outro loan).
export async function unlinkHouseFromLoan(formData: FormData): Promise<void> {
  const houseId = String(formData.get("houseId") ?? "");
  const poolId = String(formData.get("poolId") ?? "");
  if (!houseId) return;
  const house = await prisma.poolHouse.findUnique({ where: { id: houseId } });
  if (!house || house.poolId !== poolId) return;
  await prisma.poolHouse.update({ where: { id: houseId }, data: { loanId: null, bankName: null } });
  revalidatePath(`/pools/${poolId}/loan`);
}

// ── Cobranças do contrato + pagamento de juros (mock aprovado 17/07) ──────────────────

// Lança uma cobrança achada na LEITURA dos documentos. Financiada → dívida no statement
// (CLOSING_FEE/OTHER, rende juros). Em caixa → despesa do POOL (não entra no saldo do
// banco). O crédito do closing (cash-out) entra como OTHER — compõe o saldo inicial.
export async function launchLoanCharge(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const loanId = String(formData.get("loanId") ?? "").trim();
  const loan = await prisma.poolLoan.findUnique({ where: { id: loanId } });
  if (!loan || loan.poolId !== poolId) return { error: "Loan não encontrado." };
  const amount = num(formData.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Valor inválido." };
  const date = optDate(formData.get("date")) ?? new Date();
  const memo = String(formData.get("memo") ?? "").trim() || null;
  const target = String(formData.get("target") ?? "DEBT"); // DEBT | CREDIT_IN | EXPENSE
  if (target === "EXPENSE") {
    await prisma.poolExpense.create({
      data: {
        poolId,
        date,
        category: "OTHER",
        description: memo ?? "Fee do closing (pago em caixa)",
        amount,
        status: "PAID",
      },
    });
  } else {
    await prisma.poolLoanEntry.create({
      data: {
        loanId: loan.id,
        type: target === "CREDIT_IN" ? "OTHER" : "CLOSING_FEE",
        date,
        amount, // positivo: soma à dívida
        memo,
      },
    });
    await recompute(poolId);
  }
  revalidatePath(`/pools/${poolId}/loan`);
  revalidatePath(`/pools/interest`);
  return { ok: true };
}

// Registra o pagamento de juros de um período (sai do caixa do pool → reduz o devido).
export async function payLoanInterest(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const loanId = String(formData.get("loanId") ?? "").trim();
  const loan = await prisma.poolLoan.findUnique({ where: { id: loanId } });
  if (!loan || loan.poolId !== poolId) return { error: "Loan não encontrado." };
  const amount = num(formData.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Valor inválido." };
  const date = optDate(formData.get("date")) ?? new Date();
  const memo = String(formData.get("memo") ?? "").trim() || "Pagamento de juros";
  await prisma.poolLoanEntry.create({
    data: { loanId: loan.id, type: "INTEREST_PAYMENT", date, amount: -Math.abs(amount), memo },
  });
  revalidatePath(`/pools/${poolId}/loan`);
  revalidatePath(`/pools/interest`);
  return { ok: true };
}

// Drawable da casa editável no contexto do loan (17/07): o valor pode diferir do
// calculado (LOI/sim) — é a base do % de obra, da disponibilidade de draws e do
// check de suficiência do financiamento.
export async function saveHouseDrawable(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const houseId = String(formData.get("houseId") ?? "").trim();
  const house = await prisma.poolHouse.findUnique({ where: { id: houseId } });
  if (!house || house.poolId !== poolId) return { error: "Casa não encontrada." };
  const amount = optNum(formData.get("amount"));
  if (amount != null && amount < 0) return { error: "Valor inválido." };
  await prisma.poolHouse.update({ where: { id: houseId }, data: { bankLoanAmount: amount } });
  await recompute(poolId);
  revalidatePath(`/pools/${poolId}/loan`);
  revalidatePath(`/pools/${poolId}`);
  return { ok: true };
}
