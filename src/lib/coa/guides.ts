// Guias de lançamento: para cada operação comum, DIZ exatamente em quais contas debitar/creditar —
// para o lançamento sair certo no QBO e o app ler sem interpretação errada. Usa nomes de conta
// (nativos do QBO + as poucas específicas de canonical.ts). Nasce do caso do estadual num balde só.

export interface PostingLine {
  side: "D" | "C"; // débito / crédito
  account: string;
  hint?: string;
}
export interface PostingGuide {
  id: string;
  title: string;
  when: string;
  lines: PostingLine[];
  wrong?: string; // o erro comum que isto evita
  note?: string;
}

const L = (side: "D" | "C", account: string, hint?: string): PostingLine => ({ side, account, hint });

export const POSTING_GUIDES: PostingGuide[] = [
  {
    id: "estadual",
    title: "Imposto estadual (DOR) — principal, multa e juros",
    when: "Ao pagar (ou provisionar) a guia do Departamento de Receita da Flórida. O aviso do DOR traz os 3 valores separados.",
    lines: [
      L("D", "State Income Tax – Principal", "só o principal"),
      L("D", "State Income Tax – Penalty", "só a multa"),
      L("D", "State Income Tax – Interest", "só os juros"),
      L("C", "Caixa (conta bancária)", "total pago"),
    ],
    wrong: "Lançar o total numa conta única de “State Taxes”. Aí ninguém sabe quanto é principal (add-back), multa (não dedutível) ou juros (dedutível) — e o cálculo do imposto sai errado.",
    note: "Com as 3 contas separadas, o app faz o add-back exato sozinho: principal e multa voltam à base, juros ficam de fora.",
  },
  {
    id: "meals-ent",
    title: "Refeição vs Entretenimento",
    when: "Ao lançar despesa com refeição ou com entretenimento (evento, ingresso, lazer com cliente).",
    lines: [
      L("D", "Meals", "refeição — 50% dedutível (pode ter sub-contas: Team meals, Client meals…)"),
      L("D", "Entertainment", "entretenimento — conta SEPARADA, 100% não dedutível"),
      L("C", "Caixa / Cartão"),
    ],
    wrong: "Usar uma conta única “Meals & Entertainment”. O app não consegue separar o 50% (refeição) do 100% não dedutível (entretenimento) — ou super, ou subestima o add-back.",
    note: "Suas sub-contas de controle ficam DEBAIXO de “Meals” — o app soma as folhas e herda o conceito do pai.",
  },
  {
    id: "distribuicao",
    title: "Distribuição / retirada ao sócio",
    when: "Ao mandar dinheiro de uma pass-through para o sócio (ou para a holding dona).",
    lines: [
      L("D", "Distributions / Owner's Draw", "reduz a capital account"),
      L("C", "Caixa"),
    ],
    wrong: "Lançar como despesa. Distribuição NÃO é despesa — é redução de patrimônio. Como despesa, derruba o lucro e distorce o imposto.",
    note: "Reduz a base distribuível da empresa (o app acompanha em Base distribuível).",
  },
  {
    id: "ic-loan",
    title: "Empréstimo entre empresas do grupo",
    when: "Quando uma empresa do grupo empresta para outra.",
    lines: [
      L("D", "Conta de empréstimo com o NOME LEGAL exato da coligada", "credor: a receber"),
      L("C", "Caixa", "credor: saída"),
    ],
    wrong: "Nomear a coligada de formas diferentes (“VixUS” vs “Vixus”). O app casa os dois lados por nome — se divergir, some da eliminação e infla o grupo consolidado.",
    note: "Lado do devedor: D Caixa · C conta de empréstimo com o mesmo nome legal. O app casa no motor de Loans e elimina na consolidação.",
  },
  {
    id: "k1-recebido",
    title: "Renda recebida de investida (K-1 / distribuição de coligada)",
    when: "Quando a holding recebe distribuição/renda de uma empresa do grupo.",
    lines: [
      L("D", "Caixa"),
      L("C", "Intercompany Income (conta separada, nome da coligada)"),
    ],
    wrong: "Misturar com a receita operacional. Fica indistinguível na consolidação e duplica renda que já foi contada na investida.",
  },
];
