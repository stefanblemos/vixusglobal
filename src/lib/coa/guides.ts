import { CANONICAL_COA } from "./canonical";

// Guias de lançamento: para cada operação comum, DIZ exatamente em quais contas canônicas debitar/
// creditar — para o lançamento sair certo no QBO e o app ler sem interpretação errada. Nasce do caso
// que você levantou (estadual num balde só) e cobre as operações que mais confundem contador/sistema.

const nameOf = (code: string) => CANONICAL_COA.find((a) => a.code === code)?.name ?? code;

export interface PostingLine {
  side: "D" | "C"; // débito / crédito
  code: string; // conta canônica
  name: string; // resolvido
  hint?: string;
}
export interface PostingGuide {
  id: string;
  title: string;
  when: string; // quando usar
  lines: PostingLine[];
  wrong?: string; // o erro comum que isto evita
  note?: string;
}

const L = (side: "D" | "C", code: string, hint?: string): PostingLine => ({ side, code, name: nameOf(code), hint });

export const POSTING_GUIDES: PostingGuide[] = [
  {
    id: "estadual",
    title: "Imposto estadual (DOR) — principal, multa e juros",
    when: "Ao pagar (ou provisionar) a guia do Departamento de Receita da Flórida. O aviso do DOR traz os 3 valores separados.",
    lines: [
      L("D", "7100", "só o principal (imposto de renda estadual)"),
      L("D", "7110", "só a multa"),
      L("D", "7120", "só os juros"),
      L("C", "1000", "total pago (ou creditar os passivos 2500/2510/2520 se for provisão)"),
    ],
    wrong: "Lançar o total numa conta única de “State Taxes”. Aí ninguém sabe quanto é principal (add-back), multa (não dedutível) ou juros (dedutível) — e o cálculo do imposto sai errado.",
    note: "Com as 3 contas separadas, o app faz o add-back exato sozinho: principal e multa voltam à base, juros ficam de fora.",
  },
  {
    id: "distribuicao",
    title: "Distribuição / retirada ao sócio",
    when: "Ao mandar dinheiro de uma pass-through para o sócio (ou para a holding dona).",
    lines: [
      L("D", "3200", "reduz a capital account"),
      L("C", "1000"),
    ],
    wrong: "Lançar como despesa. Distribuição NÃO é despesa — é redução de patrimônio. Como despesa, derruba o lucro e distorce o imposto.",
    note: "Reduz a base distribuível da empresa (o app acompanha em Base distribuível).",
  },
  {
    id: "ic-loan",
    title: "Empréstimo entre empresas do grupo",
    when: "Quando uma empresa do grupo empresta para outra.",
    lines: [
      L("D", "1200", "credor: valor a receber da coligada"),
      L("C", "1000", "credor: saída de caixa"),
    ],
    wrong: "Usar contas de receita/despesa, ou uma conta genérica sem identificar a coligada. Some da eliminação e infla o grupo consolidado.",
    note: "Do lado do devedor: D Caixa · C “Notes Payable — Intercompany” (2800). O app casa os dois lados no motor de Loans e elimina na consolidação.",
  },
  {
    id: "ativo",
    title: "Compra de ativo fixo (depreciável)",
    when: "Ao comprar equipamento/veículo/benfeitoria que deprecia.",
    lines: [
      L("D", "1700", "custo de aquisição (base da depreciação)"),
      L("C", "1000", "ou 2000 (a prazo)"),
    ],
    wrong: "Jogar direto em despesa. O que deprecia entra no ativo (1700) e a depreciação vira despesa ao longo do tempo (6900) — senão o lucro do ano de compra afunda e o MACRS não bate.",
    note: "Cadastre o ativo em Assets para o app calcular o MACRS e conferir com o IR (Form 4562).",
  },
  {
    id: "aporte",
    title: "Aporte de capital do sócio",
    when: "Quando o sócio coloca dinheiro na empresa.",
    lines: [
      L("D", "1000"),
      L("C", "3100", "aumenta a capital account"),
    ],
    wrong: "Lançar como receita. Aporte NÃO é receita — é patrimônio. Como receita, infla o lucro e gera imposto indevido.",
  },
  {
    id: "k1-recebido",
    title: "Renda recebida de investida (K-1 / distribuição de coligada)",
    when: "Quando a holding recebe distribuição/renda de uma empresa do grupo.",
    lines: [
      L("D", "1000"),
      L("C", "4950", "renda intercompany — conta separada"),
    ],
    wrong: "Misturar com a receita operacional. Fica indistinguível na consolidação e duplica renda que já foi contada na investida.",
    note: "Conta separada (4950) permite eliminar na consolidação sem duplicar o resultado do grupo.",
  },
];
