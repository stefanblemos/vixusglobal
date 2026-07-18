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

  // investor view (Fase 4)
  "iv.list.title": { en: "Investors — consolidated view", pt: "Investidores — visão consolidada" },
  "iv.list.desc": {
    en: "One investor entity may be in several pools — one screen shows everything, pro-rata.",
    pt: "A mesma entidade investidora pode estar em vários pools — uma tela mostra tudo, pro-rata.",
  },
  "iv.list.investor": { en: "Investor", pt: "Investidor" },
  "iv.list.pools": { en: "Pools", pt: "Pools" },
  "iv.list.invested": { en: "Invested", pt: "Investido" },
  "iv.list.units": { en: "Units", pt: "Units" },
  "iv.list.view": { en: "view as investor →", pt: "ver como investidor →" },
  "iv.active": { en: "active investments", pt: "investimentos ativos" },
  "iv.k.invested": { en: "Invested", pt: "Investido" },
  "iv.k.today": { en: "Value today (NAV)", pt: "Valor hoje (NAV)" },
  "iv.k.today.h": { en: "conservative — J curve", pt: "conservador — curva J" },
  "iv.k.end": { en: "Projected at end (net)", pt: "Projeção no fim (líq.)" },
  "iv.k.end.h": { en: "@ market, after perf./costs", pt: "@ mercado, após perf./custos" },
  "iv.k.dist": { en: "Distributed", pt: "Distribuído" },
  "iv.k.next": { en: "next", pt: "próx." },
  "iv.k.irr": { en: "Your IRR", pt: "TIR do investidor" },
  "iv.k.irr.h": { en: "XIRR of YOUR flows + projection", pt: "XIRR dos SEUS fluxos + projeção" },
  "iv.k.tvpi": { en: "TVPI today → proj.", pt: "TVPI hoje → proj." },
  "iv.k.tvpi.h": { en: "net of everything", pt: "líquido de tudo" },
  "iv.stake": { en: "Your stake · invested", pt: "Sua participação · investido" },
  "iv.valueToday": { en: "Value today", pt: "Valor hoje" },
  "iv.valueToday.unsold": {
    en: "Value today (houses still unsold)",
    pt: "Valor hoje (casas ainda não vendidas)",
  },
  "iv.projEnd": { en: "Projected at end (net)", pt: "Projeção no fim (líquida)" },
  "iv.nextDist": { en: "Next distribution (your share)", pt: "Próxima distribuição (sua parte)" },
  "iv.sold": { en: "sold", pt: "vendidas" },
  "iv.chart.caption": {
    en: "value per unit ($) × time · solid = actual · dotted = net projection at market",
    pt: "valor por unit ($) × tempo · sólido = realizado · pontilhado = projeção líquida a mercado",
  },
  "iv.chart.par": { en: "par", pt: "par" },
  "iv.chart.today": { en: "today", pt: "hoje" },
  "iv.chart.start": { en: "start", pt: "início" },
  "iv.chart.end": { en: "end", pt: "fim" },
  "iv.how": { en: "how we got to", pt: "como chegamos em" },
  "iv.cas.cash": { en: "Cash available today", pt: "Caixa disponível hoje" },
  "iv.cas.futureSales": { en: "+ future sales @ ATTOM market", pt: "+ vendas futuras @ mercado ATTOM" },
  "iv.cas.payoffFull": {
    en: "− loan payoff (balance + 100% of remaining drawable)",
    pt: "− payoff dos loans (saldo + 100% do drawable restante)",
  },
  "iv.cas.equityBuild": {
    en: "− remaining build beyond the bank (equity)",
    pt: "− obra restante além do banco (equity)",
  },
  "iv.cas.excessDraw": {
    en: "+ excess draws (envelope > build)",
    pt: "+ sobra de draws (envelope > obra)",
  },
  "iv.cas.closings": { en: "− sale closing costs", pt: "− closing das vendas" },
  "iv.cas.financing": { en: "− interest & fees to come", pt: "− juros e fees por vir" },
  "iv.cas.provisioned": { en: "− provisioned expenses", pt: "− despesas provisionadas" },
  "iv.cas.windDown": { en: "− SPV wind-down (estimated)", pt: "− encerramento da SPV (estimado)" },
  "iv.cas.vehicle": { en: "− vehicle costs remaining (plan)", pt: "− custos do veículo restantes (plano)" },
  "iv.cas.performance": { en: "− 4U performance", pt: "− performance da 4U" },
  "iv.cas.promote": { en: "− Vixus promote (plan)", pt: "− promote da Vixus (plano)" },
  "iv.cas.total": { en: "Net to investors ÷ units", pt: "Líquido aos investidores ÷ units" },
  "iv.noBenchmark": {
    en: "no ATTOM sample — using plan/manual estimate",
    pt: "sem amostra ATTOM — usando plano/avaliação manual",
  },
  "iv.windDownSuggest": {
    en: "wind-down not provisioned yet — using default estimate; provision it in the pool",
    pt: "encerramento ainda não provisionado — usando estimativa padrão; provisione no pool",
  },
  "iv.activity": { en: "Activity across your investments", pt: "Atividade dos seus investimentos" },
  "iv.activity.note": {
    en: "pool milestones and amounts — never other investors' contributions",
    pt: "marcos e valores do pool — nunca os aportes dos outros sócios",
  },
  "iv.viewPool": { en: "view project →", pt: "ver projeto →" },
  "iv.link": { en: "👤 Investor view →", pt: "👤 Visão do investidor →" },
  "iv.pos.irr": { en: "IRR (your flows)", pt: "TIR (seus fluxos)" },
  "iv.pos.roi": { en: "Projected ROI", pt: "ROI projetado" },

  // extrato "conta bancária" + tax center
  "st.tab.overview": { en: "📊 Overview", pt: "📊 Visão geral" },
  "st.tab.statement": { en: "🧾 Statement", pt: "🧾 Extrato" },
  "st.tab.tax": { en: "📄 Taxes & docs", pt: "📄 Impostos & docs" },
  "st.since": { en: "with 4U since", pt: "na 4U desde" },
  "st.k.new": { en: "New capital", pt: "Capital novo" },
  "st.k.new.h": { en: "out of pocket", pt: "dinheiro que saiu do bolso" },
  "st.k.recycled": { en: "Recycled", pt: "Reciclado" },
  "st.k.recycled.h": { en: "returned money back to work", pt: "devolvido que voltou a trabalhar" },
  "st.k.returned": { en: "Total returned", pt: "Total devolvido" },
  "st.k.returned.h": { en: "distributions received", pt: "distribuições recebidas" },
  "st.k.gain": { en: "Gain since day 1", pt: "Ganho desde o início" },
  "st.k.wallet": { en: "In wallet", pt: "Na carteira" },
  "st.k.wallet.h": { en: "returned, not yet reinvested", pt: "devolvido ainda não reinvestido" },
  "st.title": { en: "Movements", pt: "Movimentações" },
  "st.c.event": { en: "Event", pt: "Evento" },
  "st.c.pool": { en: "Pool", pt: "Pool" },
  "st.c.outPocket": { en: "Out of pocket", pt: "Saiu do bolso" },
  "st.c.reused": { en: "Reused", pt: "Reuso" },
  "st.c.received": { en: "Received", pt: "Recebido" },
  "st.c.invested": { en: "Invested after", pt: "Investido após" },
  "st.ev.CONTRIBUTION": { en: "Contribution", pt: "Aporte" },
  "st.ev.CAPITAL_CALL": { en: "Capital call", pt: "Capital call" },
  "st.ev.TRANSFER_IN": { en: "Stake purchase", pt: "Compra de participação" },
  "st.ev.TRANSFER_OUT": { en: "Stake sale", pt: "Venda de participação" },
  "st.ev.DIST_CAPITAL": { en: "Distribution — return of capital", pt: "Distribuição — retorno de capital" },
  "st.ev.DIST_PROFIT": { en: "Distribution — profit", pt: "Distribuição — lucro" },
  "st.tag.new": { en: "new", pt: "novo" },
  "st.tag.reuse": { en: "reuse", pt: "reuso" },
  "st.tag.rollover": { en: "↩ direct rollover", pt: "↩ rolagem direta" },
  "st.tag.override": { en: "forced new", pt: "novo (forçado)" },
  "st.tag.proj": { en: "projection", pt: "projeção" },
  "st.proj.next": { en: "Projected distribution", pt: "Distribuição prevista" },
  "st.proj.end": { en: "Projected wind-up remainder", pt: "Restante previsto no encerramento" },
  "st.rule": {
    en: "wallet rule: everything 4U returns credits your wallet; a contribution consumes the wallet first (reuse) — only the excess is new money. IRR uses the real dated cash flows regardless.",
    pt: "regra da carteira: tudo que a 4U devolve credita sua carteira; o aporte consome a carteira primeiro (reuso) — só o excedente é dinheiro novo. A TIR usa os fluxos reais datados, independente do rótulo.",
  },
  "tax.title": { en: "Tax center", pt: "Tax center" },
  "tax.desc": {
    en: "K-1s, 1099s and your personal documents — only you see yours. E-mail notice when a new one lands.",
    pt: "K-1s, 1099s e documentos pessoais do sócio — só você vê os seus. Aviso por e-mail quando um novo chegar.",
  },
  "tax.c.year": { en: "Year", pt: "Ano" },
  "tax.c.doc": { en: "Document", pt: "Documento" },
  "tax.c.source": { en: "Source", pt: "Origem" },
  "tax.empty": {
    en: "no personal documents yet — the accountant uploads them in the pool Data room tagging the member (K-1 per member/year); they appear here automatically.",
    pt: "nenhum documento pessoal ainda — o contador sobe no Data room do pool marcando o sócio (K-1 por sócio/ano) e eles aparecem aqui sozinhos.",
  },
  "tax.k1note": {
    en: "K-1s (Form 1065) come after each year-end close; 1099-INT applies when a participation note pays interest in the year.",
    pt: "K-1s (Form 1065) chegam após o fechamento de cada ano; 1099-INT vale quando uma nota participativa paga juros no ano.",
  },
  "dr.upload.member": { en: "Member (personal doc — optional)", pt: "Sócio (doc pessoal — opcional)" },
  "dr.report.new": { en: "+ generate this month's report", pt: "+ gerar report do mês" },

  // report mensal (Fase 5)
  "rp.title": { en: "Monthly Investor Report", pt: "Monthly Investor Report" },
  "rp.generated": { en: "generated", pt: "gerado em" },
  "rp.dataUntil": { en: "data through", pt: "dados até" },
  "rp.preview": { en: "PREVIEW — not published", pt: "PRÉVIA — não publicado" },
  "rp.published": { en: "published", pt: "publicado" },
  "rp.publish": { en: "📤 Publish to Data room", pt: "📤 Publicar no Data room" },
  "rp.republish": { en: "📤 Republish (replaces snapshot)", pt: "📤 Republicar (substitui o snapshot)" },
  "rp.narrative.label": {
    en: "Narrative (edit before publishing — the investor reads this)",
    pt: "Narrativa (edite antes de publicar — o investidor lê isto)",
  },
  "rp.print": { en: "🖨 Print / PDF", pt: "🖨 Imprimir / PDF" },
  "rp.s1": { en: "1 · The month in summary", pt: "1 · O mês em resumo" },
  "rp.s2": { en: "2 · Mark & return", pt: "2 · Marcação & retorno" },
  "rp.s3": { en: "3 · Build & schedule (baseline × actual)", pt: "3 · Obra & cronograma (previsto × real)" },
  "rp.s4": { en: "4 · Risk & cash", pt: "4 · Risco & caixa" },
  "rp.s5": { en: "5 · Market (ATTOM — new construction sold)", pt: "5 · Mercado (ATTOM — casas novas vendidas)" },
  "rp.s6": { en: "6 · Distributions", pt: "6 · Distribuições" },
  "rp.k.obra": { en: "Build", pt: "Obra" },
  "rp.k.obra.h": { en: "started · sold", pt: "iniciadas · vendidas" },
  "rp.k.raised": { en: "Raised", pt: "Captado" },
  "rp.k.next": { en: "Next distribution", pt: "Próx. distribuição" },
  "rp.k.runway": { en: "Runway", pt: "Runway" },
  "rp.k.nav.h": { en: "prev. month", pt: "mês anterior" },
  "rp.c.house": { en: "House", pt: "Casa" },
  "rp.c.milestone": { en: "Milestone", pt: "Marco" },
  "rp.c.baseline": { en: "Baseline", pt: "Previsto" },
  "rp.c.actual": { en: "Actual", pt: "Real" },
  "rp.late": { en: "late", pt: "atrasado" },
  "rp.onTime": { en: "on time", pt: "no prazo" },
  "rp.sched.empty": {
    en: "no milestones this month — all houses progressing between milestones.",
    pt: "sem marcos no mês — as casas seguem entre marcos.",
  },
  "rp.risk.runway": { en: "Cash runway", pt: "Runway do caixa" },
  "rp.risk.interest": { en: "Interest/month (no reserve)", pt: "Juros/mês (sem reserve)" },
  "rp.risk.call": { en: "Suggested capital call", pt: "Capital call sugerida" },
  "rp.risk.breakeven": { en: "Breakeven — sales can drop", pt: "Breakeven — vendas podem cair" },
  "rp.market.lights": { en: "Lights across unsold houses", pt: "Faróis das casas não vendidas" },
  "rp.market.note": {
    en: "The net projection prices unsold homes AT MARKET — when it sits below plan, the difference is the market clamp, and it returns if the market validates the plan.",
    pt: "A projeção líquida usa o preço A MERCADO — quando fica abaixo do plano, a diferença é o clamp do mercado, e volta se o mercado validar o preço planejado.",
  },
  "rp.dist.inMonth": { en: "Distributed this month / cumulative", pt: "Distribuído no mês / acumulado" },
  "rp.dist.queue": { en: "Queue until wind-up", pt: "Fila até o encerramento" },
  "rp.dist.queueVal": {
    en: "{n} sales · ≈ {total} to return (capital {cap} + net profit {profit})",
    pt: "{n} vendas · ≈ {total} a devolver (capital {cap} + lucro líq. {profit})",
  },
  "rp.glossary": { en: "Glossary", pt: "Glossário" },
  "gl.nav": {
    en: "NAV (Net Asset Value): what the pool is worth today — cash + cost incurred in the houses + build appreciation − bank debt. NAV/unit divides it by all units; 'par' is the entry price per unit.",
    pt: "NAV (Net Asset Value): quanto o pool vale hoje — caixa + custo incorrido nas casas + valorização da obra − dívida com os bancos. NAV/unit divide pelo total de units; 'par' é o preço de entrada da unit.",
  },
  "gl.irr": {
    en: "IRR / TIR (Internal Rate of Return): the annualized return of your actual dated cash flows plus the remaining plan. Sensitive to time — short holds show high rates.",
    pt: "TIR (Taxa Interna de Retorno): o retorno ANUALIZADO dos fluxos reais datados + o plano restante. Sensível ao tempo — prazos curtos mostram taxas altas.",
  },
  "gl.tvpi": {
    en: "TVPI: (current value + distributions) ÷ contributed. DPI: only distributions ÷ contributed. MOIC/ROI: total multiple of the plan (1.50× = +50%).",
    pt: "TVPI: (valor atual + distribuições) ÷ aportado. DPI: só as distribuições ÷ aportado. MOIC/ROI: multiple total do plano (1,50× = +50%).",
  },
  "gl.runway": {
    en: "Runway: how many months today's free cash covers the pool's monthly obligations (mainly loan interest). Under 1 month calls for a capital call.",
    pt: "Runway: quantos meses o caixa livre de hoje cobre as obrigações mensais do pool (principalmente juros dos loans). Abaixo de 1 mês pede capital call.",
  },
  "gl.breakeven": {
    en: "Breakeven: how much sale prices can drop before the pool's net profit reaches zero.",
    pt: "Breakeven: quanto os preços de venda podem cair antes do lucro líquido do pool zerar.",
  },
  "gl.call": {
    en: "Capital call: an additional contribution requested from members when cash won't cover upcoming obligations.",
    pt: "Capital call: aporte adicional pedido aos sócios quando o caixa não cobre as próximas obrigações.",
  },
  "gl.payoff": {
    en: "Drawable / payoff: the bank's construction envelope per house; the payoff repays the full drawn balance at each sale.",
    pt: "Drawable / payoff: o envelope de obra do banco por casa; o payoff devolve o saldo sacado integral em cada venda.",
  },
  "gl.jcurve": {
    en: "J curve: financing costs and fees come out before profits, so unit value dips below par early and recovers as houses sell.",
    pt: "Curva J: custos de financiamento e fees saem antes do lucro — o valor da unit mergulha abaixo do par no início e recupera conforme as casas vendem.",
  },
  "gl.dist": {
    en: "Distribution: return of capital (your principal back) and/or profit, paid pro-rata to units as houses sell.",
    pt: "Distribuição: retorno de capital (seu principal de volta) e/ou lucro, pagos pro-rata às units conforme as casas vendem.",
  },
  "gl.market": {
    en: "AT MARKET (≈): unsold homes valued by ATTOM comparables (median $/sf of the submarket), capped at the highest observed sale — not the plan price.",
    pt: "A MERCADO (≈): casas não vendidas avaliadas pelos comparáveis ATTOM (mediana $/sf do submercado), com teto no maior valor observado — não pelo preço do plano.",
  },
  "rp.footer.disclaimer": {
    en: "≈ projections derive from the frozen baseline + ATTOM market data · not an offer of securities",
    pt: "projeções ≈ derivadas do baseline congelado + mercado ATTOM · não é oferta de valores mobiliários",
  },
} as const;

export type DictKey = keyof typeof DICT;

// mês/ano curto no idioma do CONTEÚDO (labels de projeção; datas exatas seguem o locale)
const MES = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  pt: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
} as const;
export const mesAnoLang = (d: Date, lang: Lang) => `${MES[lang][d.getUTCMonth()]}/${d.getUTCFullYear()}`;

// t(lang) → função de tradução; {n} etc. via vars
export function tOf(lang: Lang) {
  return (key: DictKey, vars?: Record<string, string | number>) => {
    let s: string = DICT[key][lang];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
}
