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
    title: "State tax (DOR) — principal, penalty and interest",
    when: "When paying (or accruing) the Florida Department of Revenue bill. The DOR notice lists the 3 amounts separately.",
    lines: [
      L("D", "State Income Tax – Principal", "principal only"),
      L("D", "State Income Tax – Penalty", "penalty only"),
      L("D", "State Income Tax – Interest", "interest only"),
      L("C", "Cash (bank account)", "total paid"),
    ],
    wrong: "Posting the total to a single “State Taxes” account. Then nobody knows how much is principal (add-back), penalty (non-deductible) or interest (deductible) — and the tax calculation comes out wrong.",
    note: "With the 3 accounts separated, the app does the exact add-back on its own: principal and penalty go back into the base, interest stays out.",
  },
  {
    id: "meals-ent",
    title: "Meals vs Entertainment",
    when: "When posting a meals expense or an entertainment expense (event, ticket, leisure with a client).",
    lines: [
      L("D", "Meals", "meals — 50% deductible (can have sub-accounts: Team meals, Client meals…)"),
      L("D", "Entertainment", "entertainment — SEPARATE account, 100% non-deductible"),
      L("C", "Cash / Card"),
    ],
    wrong: "Using a single “Meals & Entertainment” account. The app can't separate the 50% (meals) from the 100% non-deductible (entertainment) — it either over- or under-estimates the add-back.",
    note: "Your internal control sub-accounts go UNDER “Meals” — the app sums the leaves and inherits the concept from the parent.",
  },
  {
    id: "distribuicao",
    title: "Distribution / draw to owner",
    when: "When sending money from a pass-through to the owner (or to the owning holding).",
    lines: [
      L("D", "Distributions / Owner's Draw", "reduces the capital account"),
      L("C", "Cash"),
    ],
    wrong: "Posting it as an expense. A distribution is NOT an expense — it's a reduction of equity. As an expense, it drops the profit and distorts the tax.",
    note: "Reduces the company's distributable base (the app tracks it in Distributable base).",
  },
  {
    id: "ic-loan",
    title: "Loan between group companies",
    when: "When one group company lends to another.",
    lines: [
      L("D", "Loan account with the affiliate's exact LEGAL NAME", "creditor: receivable"),
      L("C", "Cash", "creditor: outflow"),
    ],
    wrong: "Naming the affiliate in different ways (“VixUS” vs “Vixus”). The app matches the two sides by name — if they diverge, it drops out of the elimination and inflates the consolidated group.",
    note: "Debtor side: D Cash · C loan account with the same legal name. The app matches it in the Loans engine and eliminates it in consolidation.",
  },
  {
    id: "k1-recebido",
    title: "Income received from an investee (K-1 / affiliate distribution)",
    when: "When the holding receives a distribution/income from a group company.",
    lines: [
      L("D", "Cash"),
      L("C", "Intercompany Income (separate account, affiliate's name)"),
    ],
    wrong: "Mixing it with operating revenue. It becomes indistinguishable in consolidation and duplicates income already counted in the investee.",
  },
];
