// Data-fix PH-4 (17/07/2026): os uploads de LOI da RBI (#16804) e da 2BTrust (#23169)
// sobrescreveram o loan FCI e o perfil FCI do banco (o pipeline antigo aplicava sempre no
// banco do loan). Termos reais recuperados dos PDFs arquivados:
//   FCI   #399671570 — portal de servicing: original $1.646.000, note rate 11%,
//         originação 05/08/2026, maturity 12/01/2027; property list = 6 casas.
//   RBI   #16804 — LOI 02/07/2026: total $211.499,91 (holdback $209.999,90), 9%, 12m,
//         casa 1601 W Country Club Blvd (Citrus Springs).
//   2BT   #23169 — LOI 23/04/2026: $170.000, 12% fixo, 9m + 3 extensões,
//         casa 16497 SW 31st Ter (Ocala).
// Restaura o loan original como FCI, cria os loans RBI e 2BTrust, move documentos e
// BankLoi para os perfis certos, realoca as 2 casas e conserta o perfil FCI.
// Idempotente e condicionado às assinaturas da corrupção — no-op depois de aplicado e
// se o usuário já tiver arrumado na tela.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const pool = await prisma.investmentPool.findUnique({
    where: { code: "PH-4" },
    include: { loans: { include: { bankProfile: true } }, houses: true },
  });
  if (!pool) return console.log("PH-4 não encontrado — nada a fazer");

  const fciBank = await prisma.bankProfile.findFirst({ where: { name: { contains: "FCI" } } });
  const rbiBank = await prisma.bankProfile.findUnique({ where: { name: "RBI Private Lending" } });
  const btBank = await prisma.bankProfile.findUnique({ where: { name: "2BTrust" } });
  if (!fciBank || !rbiBank || !btBank)
    return console.log("perfis de banco ausentes (FCI/RBI/2BTrust) — verificar manualmente");

  // 1) restaura o loan corrompido → FCI (assinatura: loan único #23169 sem loan FCI no pool)
  let fciLoan = pool.loans.find((l) => l.loanNumber === "399671570");
  const corrupted = pool.loans.find(
    (l) => l.loanNumber === "23169" && l.bankProfileId !== btBank.id,
  );
  if (!fciLoan && corrupted) {
    fciLoan = await prisma.poolLoan.update({
      where: { id: corrupted.id },
      data: {
        bankProfileId: fciBank.id,
        loanNumber: "399671570",
        committed: 1646000,
        aprPct: 11,
        closingDate: new Date("2026-05-08"),
        notes:
          "Restaurado 17/07/2026 do portal FCI (Loan Detail 399671570): original $1.646.000, note rate 11%, originação 05/08/2026, maturity 12/01/2027; property list = 6 casas. O loan tinha sido sobrescrito pelos LOIs da RBI (#16804) e da 2BTrust (#23169) — agora em loans próprios.",
      },
    });
    console.log("loan corrompido restaurado como FCI #399671570");
  }
  if (!fciLoan) return console.log("loan FCI não identificado — nada a fazer");

  // 2) loan RBI (create-only)
  let rbiLoan = pool.loans.find(
    (l) => l.loanNumber === "16804" || (l.bankProfileId === rbiBank.id && l.id !== fciLoan.id),
  );
  if (!rbiLoan) {
    rbiLoan = await prisma.poolLoan.create({
      data: {
        poolId: pool.id,
        bankProfileId: rbiBank.id,
        loanNumber: "16804",
        committed: 211499.91,
        aprPct: 9,
        firstContactDate: new Date("2026-07-02"),
        notes:
          "LOI #16804 de 02/07/2026 (1601 W Country Club Blvd): total $211.499,91 (holdback $209.999,90), 9% interest-only non-Dutch, 12 meses. Aguardando closing.",
      },
    });
    console.log("loan RBI #16804 criado");
  }

  // 3) loan 2BTrust (create-only)
  let btLoan = pool.loans.find((l) => l.bankProfileId === btBank.id);
  if (!btLoan) {
    btLoan = await prisma.poolLoan.create({
      data: {
        poolId: pool.id,
        bankProfileId: btBank.id,
        loanNumber: "23169",
        committed: 170000,
        aprPct: 12,
        firstContactDate: new Date("2026-04-23"),
        notes:
          "LOI #23169 de 23/04/2026 (16497 SW 31st Ter, Ocala): $170.000, 12% fixo, 9 meses + 3 extensões, origination 2%. Aguardando closing.",
      },
    });
    console.log("loan 2BTrust #23169 criado");
  }

  // 4) documentos do pool: cada LOI vai para a pasta do seu loan
  const moves = [
    { startsWith: "1601 West Country Club", to: rbiLoan.id },
    { startsWith: "loanEstimate_16497", to: btLoan.id },
  ];
  for (const m of moves) {
    const { count } = await prisma.poolLoanDocument.updateMany({
      where: { loanId: fciLoan.id, fileName: { startsWith: m.startsWith } },
      data: { loanId: m.to },
    });
    if (count > 0) console.log(`doc "${m.startsWith}…" movido para o loan certo`);
  }

  // 5) BankLoi: os PDFs foram arquivados no perfil FCI — reatribui ao perfil do credor
  const loiMoves = [
    { startsWith: "1601 West Country Club", to: rbiBank.id },
    { startsWith: "loanEstimate_16497", to: btBank.id },
  ];
  for (const m of loiMoves) {
    const { count } = await prisma.bankLoi.updateMany({
      where: { bankProfileId: fciBank.id, fileName: { startsWith: m.startsWith } },
      data: { bankProfileId: m.to },
    });
    if (count > 0) console.log(`BankLoi "${m.startsWith}…" reatribuído ao perfil do credor`);
  }

  // 6) casas: realoca as 2 fora da property list da FCI (guard: ainda apontando p/ FCI)
  const houseMoves = [
    { startsWith: "1601 W Country Club", bankName: rbiBank.name, loanId: rbiLoan.id, amountIf: 190000, amount: 209999.9 },
    { startsWith: "16497 SW 31st Ter", bankName: btBank.name, loanId: btLoan.id, amountIf: 225000, amount: 170000 },
  ];
  for (const m of houseMoves) {
    const house = pool.houses.find((h) => h.address.startsWith(m.startsWith));
    if (!house) continue;
    const stillFci = (house.bankName ?? "").includes("FCI") || house.loanId === fciLoan.id || house.loanId == null;
    if (!stillFci) continue;
    await prisma.poolHouse.update({
      where: { id: house.id },
      data: {
        bankName: m.bankName,
        loanId: m.loanId,
        // valor do loan da casa só se ainda for o chute da simulação (não pisa em edição manual)
        ...(Number(house.bankLoanAmount) === m.amountIf ? { bankLoanAmount: m.amount } : {}),
      },
    });
    console.log(`casa ${m.startsWith}… → ${m.bankName}`);
  }
  // as 6 da property list da FCI: garante o vínculo com o loan FCI
  for (const h of pool.houses) {
    if (houseMoves.some((m) => h.address.startsWith(m.startsWith))) continue;
    if (h.loanId == null) {
      await prisma.poolHouse.update({ where: { id: h.id }, data: { loanId: fciLoan.id } });
    }
  }

  // 7) perfil FCI: sobrescrito pelo LOI da 2BTrust (assinatura nas notes) — restaura o que
  // o servicing comprova; fees continuam por confirmar no contrato real
  if ((fciBank.notes ?? "").includes("2BTRUST")) {
    await prisma.bankProfile.update({
      where: { id: fciBank.id },
      data: {
        aprPct: 11,
        termMonths: 19,
        notes:
          "Reconstruído 17/07/2026 do portal de servicing (loan 399671570): note rate 11%, original $1.646.000, originação 05/08/2026, maturity 12/01/2027 (~19 meses). ATENÇÃO: fees/origination deste perfil vieram do LOI da 2BTrust aplicado por engano — confirmar no contrato FCI real.",
      },
    });
    console.log("perfil FCI: 11%/19m restaurados; fees pendentes do contrato real");
  }

  console.log("fix-ph4-loans concluído");
}

main().finally(() => prisma.$disconnect());
