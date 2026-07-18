/**
 * Extrato "conta bancária" do investidor (regra da carteira aprovada 19/07/2026):
 * tudo que a 4U devolve credita a CARTEIRA; um aporte consome a carteira primeiro
 * (reuso) e só o excedente é dinheiro NOVO — novo = max(0, aporte − carteira).
 * Rolagem direta (rolloverOfDistributionId) é fato; sem vínculo, a carteira é a
 * presunção; newMoneyOverride força "novo" sem consumir a carteira.
 * A TIR NÃO depende desta classificação (XIRR usa os fluxos datados reais).
 * Módulo puro — extrato do investidor, statement PDF e report usam a mesma conta.
 */

const round2 = (v: number) => Math.round(v * 100) / 100;

export type StmtMovement = {
  type: "CONTRIBUTION" | "CAPITAL_CALL" | "TRANSFER_IN" | "DIST_CAPITAL" | "DIST_PROFIT" | "TRANSFER_OUT";
  date: Date;
  amount: number;
  poolCode: string;
  rollover?: boolean; // vínculo explícito com uma distribuição (só débitos)
  newMoneyOverride?: boolean; // só débitos
  memo?: string | null;
};

export type StmtRow = {
  date: Date;
  poolCode: string;
  kind: StmtMovement["type"];
  outNew: number; // saiu do bolso (dinheiro novo)
  outReused: number; // reuso da carteira
  received: number; // devoluções/vendas de participação
  investedAfter: number;
  walletAfter: number;
  rollover: boolean;
  override: boolean;
  memo?: string | null;
};

export type StmtResult = {
  rows: StmtRow[];
  newCapital: number; // dinheiro que saiu do bolso na vida inteira
  recycled: number; // devolvido que voltou a trabalhar
  returned: number; // total devolvido (capital + lucro + vendas de participação)
  realizedProfit: number; // Σ distribuições de LUCRO
  investedNow: number; // principal atualmente investido
  wallet: number; // devolvido ainda não reinvestido (argumento p/ o próximo pool)
  firstDate: Date | null; // D=0 na 4U
};

// ordem no mesmo dia: créditos (devoluções) antes dos débitos — rolagem same-day funciona
const rank = (t: StmtMovement["type"]) =>
  t === "DIST_CAPITAL" || t === "DIST_PROFIT" || t === "TRANSFER_OUT" ? 0 : 1;

export function buildInvestorStatement(movements: StmtMovement[]): StmtResult {
  const evs = [...movements].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || rank(a.type) - rank(b.type),
  );
  let wallet = 0;
  let invested = 0;
  let newCapital = 0;
  let recycled = 0;
  let returned = 0;
  let realizedProfit = 0;
  const rows: StmtRow[] = [];

  for (const e of evs) {
    const a = Math.abs(e.amount);
    if (e.type === "DIST_CAPITAL" || e.type === "DIST_PROFIT" || e.type === "TRANSFER_OUT") {
      wallet = round2(wallet + a);
      returned = round2(returned + a);
      if (e.type === "DIST_PROFIT") realizedProfit = round2(realizedProfit + a);
      else invested = round2(Math.max(0, invested - a));
      rows.push({
        date: e.date,
        poolCode: e.poolCode,
        kind: e.type,
        outNew: 0,
        outReused: 0,
        received: a,
        investedAfter: invested,
        walletAfter: wallet,
        rollover: false,
        override: false,
        memo: e.memo,
      });
    } else {
      // aporte/compra: override = tudo novo sem consumir carteira; senão consome primeiro
      const override = e.newMoneyOverride ?? false;
      const reused = override ? 0 : round2(Math.min(wallet, a));
      const novo = round2(a - reused);
      wallet = round2(wallet - reused);
      invested = round2(invested + a);
      newCapital = round2(newCapital + novo);
      recycled = round2(recycled + reused);
      rows.push({
        date: e.date,
        poolCode: e.poolCode,
        kind: e.type,
        outNew: novo,
        outReused: reused,
        received: 0,
        investedAfter: invested,
        walletAfter: wallet,
        rollover: e.rollover ?? false,
        override,
        memo: e.memo,
      });
    }
  }
  return {
    rows,
    newCapital,
    recycled,
    returned,
    realizedProfit,
    investedNow: invested,
    wallet,
    firstDate: rows[0]?.date ?? null,
  };
}
