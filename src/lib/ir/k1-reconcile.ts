import { entityNames, ownerNameMatches } from "@/lib/ownership/reconcile";
import { normalizeName } from "@/lib/qbo/match";

// Conciliação intercompany de K-1 × 1065, a nível da holding inteira.
//
// Cada relação pass-through tem DOIS lados que precisam bater:
//  • o EMISSOR (investida) aloca renda ao sócio no 1065 → linha "owners[].allocatedIncome".
//  • o RECEBEDOR (sócia) declara ter recebido aquele K-1 → linha "k1sReceived[].amount".
// O contador acerta quando os dois lados existem e os valores batem. Os erros típicos:
//  • missingOnRecipient — o 1065 do emissor alocou, mas o recebedor não lançou o K-1 recebido.
//  • missingOnIssuer    — o recebedor declarou o K-1, mas o 1065 do emissor não o lista.

export type K1Owner = {
  name: string;
  taxIdLast4: string | null;
  ownershipPct: number | null;
  allocatedIncome: number | null;
  role: string | null;
};

export type K1Received = { issuerName: string; issuerEin: string; amount: number };

export type K1Company = {
  id: string;
  legalName: string;
  tradeName: string | null;
  aliases: string[];
  taxId: string | null;
};

export type K1Figure = { label: string; value: number | null; line: string | null };

export type K1Return = {
  companyId: string | null;
  year: number | null;
  taxForm: string | null;
  owners: K1Owner[] | null;
  k1sReceived: K1Received[] | null;
  figures?: K1Figure[] | null;
};

export type K1Status =
  | "match" // os dois lados batem
  | "amountDiff" // os dois declaram, valores divergem
  | "missingOnRecipient" // emissor alocou; recebedor tem IR no ano mas não lançou o K-1
  | "reportedInTotal" // recebedor reportou pass-through em bloco na linha 4, sem itemizar por emissor
  | "missingOnIssuer" // recebedor declarou; IR do emissor existe mas não o lista
  | "noAlloc" // recebedor declarou; emissor lista o sócio mas sem valor no K-1
  | "issuerIrMissing" // recebedor declarou; emissor sem IR carregado no ano
  | "recipientIrMissing"; // emissor alocou; recebedor sem IR carregado no ano

// Pass-through na linha 4 do 1065 ("from other partnerships, estates, and trusts"):
// o total de K-1 recebidos que o IR reportou — pode não estar itemizado por emissor.
function lineFourOf(figures: K1Figure[] | null | undefined): number | null {
  const f = (figures ?? []).find(
    (x) =>
      /other partnerships|estates,? and trusts|outras sociedades/i.test(x.label) ||
      /\bline\s*4\b/i.test(x.line ?? ""),
  );
  return f?.value ?? null;
}

export type K1Edge = {
  year: number;
  issuerId: string | null;
  issuerName: string;
  recipientId: string;
  recipientName: string;
  issuerAmount: number | null; // alocado no 1065 do emissor
  recipientAmount: number | null; // recebido no K-1 do recebedor
  status: K1Status;
};

export const K1_PROBLEM_STATUSES: K1Status[] = [
  "amountDiff",
  "missingOnRecipient",
  "missingOnIssuer",
];

const einDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

// Escolhe o IR canônico de cada (empresa, ano): prefere o formulário pass-through
// (1065/1120-S) e, em empate, o que tem sócios/K-1 preenchidos.
function buildCanonical(returns: K1Return[]): Map<string, K1Return> {
  const score = (r: K1Return) => {
    let s = 0;
    const f = (r.taxForm ?? "").replace(/\D/g, "");
    if (f.includes("1065") || f.includes("1120")) s += 4;
    if ((r.owners?.length ?? 0) > 0) s += 2;
    if ((r.k1sReceived?.length ?? 0) > 0) s += 1;
    return s;
  };
  const best = new Map<string, K1Return>();
  for (const r of returns) {
    if (!r.companyId || r.year == null) continue;
    const key = `${r.companyId}:${r.year}`;
    const cur = best.get(key);
    if (!cur || score(r) > score(cur)) best.set(key, r);
  }
  return best;
}

export function reconcileK1s(returns: K1Return[], companies: K1Company[]): K1Edge[] {
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const companyByEin = new Map(
    companies.filter((c) => einDigits(c.taxId)).map((c) => [einDigits(c.taxId), c]),
  );
  const namesOf = (c: K1Company) => entityNames(c);

  const resolveCompany = (name: string, ein?: string | null): K1Company | null => {
    const e = einDigits(ein);
    if (e && companyByEin.has(e)) return companyByEin.get(e)!;
    return companies.find((c) => ownerNameMatches(namesOf(c), name)) ?? null;
  };

  const canonical = buildCanonical(returns);
  const getReturn = (companyId: string, year: number) => canonical.get(`${companyId}:${year}`);

  // 1) Descobre todos os pares (emissor → recebedor, ano) dos dois lados.
  type Cand = {
    year: number;
    issuerId: string | null;
    issuerName: string;
    recipientId: string;
    recipientName: string;
  };
  const cands = new Map<string, Cand>();
  const keyOf = (issuerId: string | null, issuerName: string, recipientId: string, year: number) =>
    `${issuerId ?? "n:" + normalizeName(issuerName)}>${recipientId}@${year}`;

  for (const r of returns) {
    if (!r.companyId || r.year == null) continue;
    const recipient = companyById.get(r.companyId);
    if (!recipient) continue;

    // Lado RECEBEDOR: cada K-1 que esta empresa declarou ter recebido.
    for (const k of r.k1sReceived ?? []) {
      const issuer = resolveCompany(k.issuerName, k.issuerEin);
      const issuerName = issuer?.legalName ?? k.issuerName;
      const key = keyOf(issuer?.id ?? null, issuerName, recipient.id, r.year);
      if (!cands.has(key))
        cands.set(key, {
          year: r.year,
          issuerId: issuer?.id ?? null,
          issuerName,
          recipientId: recipient.id,
          recipientName: recipient.legalName,
        });
    }
  }

  // Lado EMISSOR: cada sócio com renda alocada que casa com uma empresa registrada.
  for (const r of returns) {
    if (!r.companyId || r.year == null) continue;
    const issuer = companyById.get(r.companyId);
    if (!issuer) continue;
    for (const o of r.owners ?? []) {
      if (o.allocatedIncome == null) continue;
      const recipient = companies.find((c) => ownerNameMatches(namesOf(c), o.name));
      if (!recipient || recipient.id === issuer.id) continue; // só intercompany
      const key = keyOf(issuer.id, issuer.legalName, recipient.id, r.year);
      if (!cands.has(key))
        cands.set(key, {
          year: r.year,
          issuerId: issuer.id,
          issuerName: issuer.legalName,
          recipientId: recipient.id,
          recipientName: recipient.legalName,
        });
    }
  }

  // 2) Para cada par, lê os dois valores direto dos IRs canônicos e classifica.
  const edges: K1Edge[] = [];
  for (const c of cands.values()) {
    const recipient = companyById.get(c.recipientId)!;
    const issuer = c.issuerId ? companyById.get(c.issuerId) : null;

    const issuerRet = c.issuerId ? getReturn(c.issuerId, c.year) : undefined;
    const recipRet = getReturn(c.recipientId, c.year);

    // Lado emissor: o recebedor aparece como sócio no 1065? Com quanto?
    const issuerOwner = issuerRet?.owners?.find((o) =>
      ownerNameMatches(entityNames(recipient), o.name),
    );
    const issuerListed = !!issuerOwner;
    const issuerAmount = issuerOwner?.allocatedIncome ?? null;

    // Lado recebedor: declarou ter recebido K-1 deste emissor? Com quanto?
    const recipK1 = recipRet?.k1sReceived?.find((k) => {
      if (issuer) {
        const r = resolveCompany(k.issuerName, k.issuerEin);
        if (r) return r.id === issuer.id;
      }
      return normalizeName(k.issuerName) === normalizeName(c.issuerName);
    });
    const recipientAmount = recipK1?.amount ?? null;

    let status: K1Status;
    if (issuerAmount != null && recipientAmount != null) {
      const tol = Math.max(1, Math.max(Math.abs(issuerAmount), Math.abs(recipientAmount)) * 0.01);
      status = Math.abs(issuerAmount - recipientAmount) <= tol ? "match" : "amountDiff";
    } else if (recipientAmount != null) {
      // recebedor declarou; o lado do emissor está incompleto
      if (!issuerRet) status = "issuerIrMissing";
      else if (!issuerListed) status = "missingOnIssuer";
      else status = "noAlloc";
    } else if (issuerAmount != null) {
      // emissor alocou; recebedor não declarou o K-1
      status = recipRet ? "missingOnRecipient" : "recipientIrMissing";
    } else {
      continue; // sem valor em nenhum lado — nada a conciliar
    }

    edges.push({
      year: c.year,
      issuerId: c.issuerId,
      issuerName: c.issuerName,
      recipientId: c.recipientId,
      recipientName: c.recipientName,
      issuerAmount,
      recipientAmount,
      status,
    });
  }

  // Pós-passo: reconhece pass-through reportado EM BLOCO na linha 4 (sem itemização por
  // emissor). Se a linha 4 do recebedor cobre tudo que lhe foi alocado e ainda não está
  // itemizado, não é omissão — é só falta de detalhamento. Evita falso "not declared".
  const byRecip = new Map<string, K1Edge[]>();
  for (const e of edges) {
    const k = `${e.recipientId}@${e.year}`;
    const arr = byRecip.get(k);
    if (arr) arr.push(e);
    else byRecip.set(k, [e]);
  }
  for (const [k, group] of byRecip) {
    const at = k.lastIndexOf("@");
    const recipientId = k.slice(0, at);
    const year = Number(k.slice(at + 1));
    const line4 = lineFourOf(getReturn(recipientId, year)?.figures);
    if (line4 == null) continue;
    const itemized = group
      .filter((e) => e.recipientAmount != null)
      .reduce((s, e) => s + (e.recipientAmount as number), 0);
    const missing = group.filter((e) => e.status === "missingOnRecipient");
    const missingSum = missing.reduce((s, e) => s + (e.issuerAmount as number), 0);
    const budget = line4 - itemized; // parte da linha 4 ainda não explicada por itens itemizados
    const tol = Math.max(1, Math.abs(line4) * 0.02);
    if (Math.abs(missingSum) <= Math.abs(budget) + tol) {
      for (const e of missing) e.status = "reportedInTotal";
    }
  }

  // Ordena: problemas primeiro, depois por ano desc, depois por emissor.
  const rank = (s: K1Status) =>
    K1_PROBLEM_STATUSES.includes(s) ? 0 : s === "match" ? 2 : 1;
  edges.sort(
    (a, b) =>
      rank(a.status) - rank(b.status) ||
      b.year - a.year ||
      a.issuerName.localeCompare(b.issuerName),
  );
  return edges;
}
