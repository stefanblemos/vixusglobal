/**
 * i18n leve do módulo Investments (Fase 3, aprovado 18/07/2026): conteúdo segue o
 * seletor EN | PT (cookie inv_lang, default EN); DATAS seguem o locale do
 * Windows/navegador do usuário (Accept-Language → Intl), independente do seletor;
 * moeda sempre USD. Mesmo padrão do tr() do report de investimento (EN/PT-BR/ES).
 * Telas novas nascem bilíngues; as abas antigas migram uma a uma (novo escopo da #52).
 */

export type Lang = "en" | "pt";
export const INV_LANG_COOKIE = "inv_lang";

export const langFromCookie = (v: string | undefined): Lang => (v === "pt" ? "pt" : "en");

const DICT = {
  // sub-abas de Investidores
  "sub.members": { en: "👥 Members", pt: "👥 Sócios" },
  "sub.ledger": { en: "📒 Capital ledger", pt: "📒 Capital ledger" },
  "sub.distributions": { en: "📤 Distributions", pt: "📤 Distribuições" },
  "sub.dataroom": { en: "📁 Data room", pt: "📁 Data room" },

  // data room
  "dr.title": { en: "Pool documents", pt: "Documentos do pool" },
  "dr.desc": {
    en: "Everything in one place. Loan documents flow in automatically (from the Financing tab); upload the rest by category. The toggle controls what investors see in the portal — default: internal.",
    pt: "Tudo num lugar só. Docs dos loans entram sozinhos (da aba Financiamento); os demais você sobe por categoria. O toggle define o que o investidor verá no portal — padrão: interno.",
  },
  "dr.add": { en: "+ Document", pt: "+ Documento" },
  "dr.g.financing": { en: "🏦 Financing (automatic — from loan readings)", pt: "🏦 Financiamento (automático — leitura dos loans)" },
  "dr.g.corporate": { en: "🏛 Corporate", pt: "🏛 Societário" },
  "dr.g.reports": { en: "📊 Reports", pt: "📊 Reports" },
  "dr.g.other": { en: "📎 Other", pt: "📎 Outros" },
  "dr.c.document": { en: "Document", pt: "Documento" },
  "dr.c.source": { en: "Source", pt: "Origem" },
  "dr.c.type": { en: "Type", pt: "Tipo" },
  "dr.c.readOn": { en: "Read on", pt: "Lido em" },
  "dr.c.uploadedOn": { en: "Uploaded on", pt: "Enviado em" },
  "dr.c.visibility": { en: "Visibility", pt: "Visibilidade" },
  "dr.internal": { en: "Internal", pt: "Interno" },
  "dr.portal": { en: "Portal", pt: "Portal" },
  "dr.oa.pending": { en: "pending OA", pt: "aguardando OA" },
  "dr.oa.lands": { en: "lands here once generated", pt: "entra aqui quando gerado" },
  "dr.corporate.empty": {
    en: 'no documents yet — use "+ Document" (EIN, certificates, contracts)',
    pt: 'nenhum documento enviado — use "+ Documento" (EIN, certidões, contratos)',
  },
  "dr.reports.auto": {
    en: "the monthly report (Phase 5) publishes here automatically, already Portal-visible",
    pt: "o report mensal (Fase 5) publica aqui automaticamente, já com visibilidade Portal",
  },
  "dr.upload.category": { en: "Category", pt: "Categoria" },
  "dr.upload.file": { en: "PDF file(s)", pt: "Arquivo(s) PDF" },
  "dr.upload.send": { en: "Upload", pt: "Enviar" },
  "dr.delete.confirm": { en: "Remove this document?", pt: "Remover este documento?" },

  // categorias (docType → grupo)
  "cat.CORPORATE": { en: "Corporate", pt: "Societário" },
  "cat.REPORTS": { en: "Reports", pt: "Reports" },
  "cat.OTHER": { en: "Other", pt: "Outros" },

  // taxas & partes relacionadas
  "fees.title": { en: "Fees & related parties", pt: "Taxas & partes relacionadas" },
  "fees.desc": {
    en: "Cost transparency: what 4U earns in this pool and which transactions involve related parties. Investors will see this block in the portal.",
    pt: "Transparência de custos: o que a 4U ganha neste pool e quais transações envolvem partes relacionadas. O investidor verá este bloco no portal.",
  },
  "fees.perf": { en: "4U compensation — performance", pt: "Remuneração da 4U — performance" },
  "fees.perf.none": { en: "not configured in this pool", pt: "não configurada neste pool" },
  "fees.perf.ofProfit": { en: "of the profit", pt: "do lucro" },
  "fees.timing.PER_SALE": { en: "each sale", pt: "a cada venda" },
  "fees.timing.PROJECT_COMPLETION": { en: "at project completion", pt: "no fechamento do projeto" },
  "fees.contractor": { en: "4U compensation — contractor fee", pt: "Remuneração da 4U — contractor fee" },
  "fees.contractor.embedded": {
    en: "embedded in build cost (contract price per house)",
    pt: "embutida no custo de obra (preço de contrato por casa)",
  },
  "fees.promote": { en: "Vixus promote (waterfall)", pt: "Promote da Vixus (waterfall)" },
  "fees.plan": { en: "plan", pt: "plano" },
  "fees.vehicle": { en: "Vehicle costs (formation/maintenance)", pt: "Custos do veículo (abertura/manutenção)" },
  "fees.vehicle.waived": { en: "$0 — waived by 4U in this pool", pt: "$0 — waiver da 4U neste pool" },
  "fees.c.party": { en: "Party", pt: "Parte" },
  "fees.c.role": { en: "Role in the pool", pt: "Papel no pool" },
  "fees.c.rel": { en: "Relationship", pt: "Relação" },
  "fees.c.where": { en: "Where the amount lives", pt: "Onde está o valor" },
  "fees.related": { en: "related", pt: "relacionada" },
  "fees.independent": { en: "independent", pt: "independentes" },
  "fees.builder.role": { en: "Builder of the {n} houses", pt: "Construtora das {n} casas" },
  "fees.builder.where": { en: "build cost per house → Houses tab", pt: "custo de obra por casa → aba Casas" },
  "fees.sponsor.role": { en: "Sponsor / manager", pt: "Organizadora / gestora" },
  "fees.sponsor.where.waived": { en: "waived — no charge in this pool", pt: "waiver — sem cobrança neste pool" },
  "fees.sponsor.where.vehicle": { en: "vehicle costs above (plan)", pt: "custos do veículo acima (plano)" },
  "fees.sponsor.where.note": { en: "participation note → Companies", pt: "nota participativa → Companies" },
  "fees.lenders.role": { en: "Lenders (construction loans)", pt: "Credores (construction loans)" },
  "fees.lenders.where": { en: "interest & fees → Financing tab", pt: "juros e fees → aba Financiamento" },
  "fees.source": {
    en: "source: pool registration (performance/entity) + origin simulation (vehicle costs) — nothing typed by hand.",
    pt: "fonte: cadastro do pool (performance/entity) + simulação de origem (custos de veículo) — nada digitado à mão.",
  },
} as const;

export type DictKey = keyof typeof DICT;

// t(lang) → função de tradução; {n} etc. via vars
export function tOf(lang: Lang) {
  return (key: DictKey, vars?: Record<string, string | number>) => {
    let s: string = DICT[key][lang];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
}
