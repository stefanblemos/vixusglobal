"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { signSubscription, updateWizardData, type SubFormState } from "@/lib/actions/subscriptions";
import {
  ACCREDITATION_OPTIONS,
  INVESTOR_TYPES,
  missingForSignature,
  type UboRow,
  type WizardData,
} from "@/lib/subscription/types";

// Wizard de subscrição online — investidor responde, a plataforma GERA os documentos
// preenchidos (ninguém preenche formulário). Mock aprovado 19/07/2026; regra do
// investidor recorrente: pré-preenche do perfil anterior com banner "revise".

const DICT = {
  en: {
    invite: "You have been invited to invest in",
    unitsLabel: "Units × unit price",
    unitsField: "Units", amountField: "Amount (US$)",
    unitsHint: "Type any amount — units or dollars. 1 unit =",
    commitment: "Capital Commitment · progressive capital calls",
    callNote: "Funding is not upfront: you fund as capital calls are issued (minimum 10 business days' notice), per Article IV of the Operating Agreement.",
    step: ["Investment", "Identity", "Accreditation", "Ownership", "Tax", "Review & sign"],
    identityTitle: "Investor identification",
    identitySub: "Investing through an entity? Enter the entity here; relevant owners come next.",
    type: "Type", legalName: "Legal name", jurisdiction: "Jurisdiction", tin: "Tax ID (EIN / TIN)",
    email: "E-mail (portal & notices)", phone: "Phone", address: "Principal address",
    exName: "e.g. Smith Family Holdings LLC",
    exJurEntity: "e.g. Florida, USA (state where the entity is registered)",
    exJurInd: "e.g. Brazil (country of residence)",
    exTinEntity: "e.g. 88-1234567 (EIN)", exTinInd: "e.g. SSN / ITIN, or foreign tax ID",
    exAddr: "e.g. 4000 Central Blvd, Orlando, FL 32816",
    exPhone: "e.g. +1 407 555 0199", exSource: "e.g. distributions from my operating company",
    accreditationTitle: "Investor qualification — check what applies",
    accreditationWhat: "Under U.S. securities law, a private offering like this can only accept “qualified” (accredited) investors. This step confirms the investing party meets one of those criteria — nothing here is published; it just documents eligibility. Answer for the party that is investing (the entity, if you are investing through a company).",
    accreditationSub: "Self-certification under Rule 506(b).",
    uboTitle: "Owners of 25%+ and control person",
    uboSub: "Bank/AML requirement. A photo ID will be requested for each person listed.",
    uboName: "Name", uboPct: "Ownership %", uboControl: "control person", uboAdd: "+ add owner",
    taxTitle: "Tax status of the investing party",
    taxSub: "This is about the entity or person that is investing — not its owners. If a U.S. company is investing, it is a “U.S. person” and files a W-9, even when its owners live abroad (those owners are listed in the Owners step).",
    usYes: "The investing party is a “U.S. person” (e.g. a U.S. LLC or corporation, or a U.S. resident) → the system prepares Form W-9",
    usNo: "The investing party is NOT a “U.S. person” (a foreign person or foreign entity) → the system prepares Form W-8BEN / W-8BEN-E",
    classification: "U.S. tax classification (entities)", source: "Source of funds",
    reviewTitle: "Your package was generated — review and sign",
    reviewSub: "Everything filled from your answers. Open each document before signing.",
    docSub: "Subscription Agreement", docQ: "Investor Questionnaire (Part III)", docJ: "Amendment & Joinder",
    generated: "✓ generated", open: "open",
    signLabel: "Electronic signature — type your full legal name",
    consent: "I agree to sign electronically (E-SIGN/UETA) and certify the information provided is true. IP, timestamp and document hash will be recorded.",
    signBtn: "Sign and submit ✍", signing: "Signing…",
    back: "← Back", next: "Continue →",
    prefillBanner: "We pre-filled your data from your previous investment — please review each step before signing.",
    statusTitle: "Your admission — status",
    statusSub: "You will receive an e-mail at each stage.",
    stSigned: "Package signed electronically", stKyc: "KYC/AML review", stAccept: "Awaiting Manager acceptance",
    stWire: "Wire instructions released in the portal (never by e-mail) + phone verification",
    stMember: "Exhibit A updated — you are a member and the portal opens with your statement",
    accepted: "Admission accepted — welcome aboard!",
    rejected: "This subscription was not accepted. Contact the Manager.",
    missing: "Complete the previous steps before signing:",
  },
  pt: {
    invite: "Você foi convidado a investir no",
    unitsLabel: "Units × preço da unit",
    unitsField: "Units", amountField: "Valor (US$)",
    unitsHint: "Digite qualquer valor — em units ou em dólares. 1 unit =",
    commitment: "Capital Commitment · chamadas progressivas",
    callNote: "O aporte não é à vista: você funda conforme as capital calls (aviso mínimo de 10 dias úteis), pelo Artigo IV do Operating Agreement.",
    step: ["Investimento", "Identidade", "Credenciamento", "Sócios", "Fiscal", "Revisão e assinatura"],
    identityTitle: "Identificação do investidor",
    identitySub: "Investindo por pessoa jurídica? Os dados da empresa entram aqui; os sócios relevantes vêm no próximo passo.",
    type: "Tipo", legalName: "Razão social / nome", jurisdiction: "Jurisdição", tin: "Tax ID (EIN / TIN)",
    email: "E-mail (portal e avisos)", phone: "Telefone", address: "Endereço principal",
    exName: "ex.: Smith Family Holdings LLC",
    exJurEntity: "ex.: Florida, USA (estado onde a empresa está registrada)",
    exJurInd: "ex.: Brasil (país de residência)",
    exTinEntity: "ex.: 88-1234567 (EIN)", exTinInd: "ex.: CPF / ITIN, ou tax ID do seu país",
    exAddr: "ex.: 4000 Central Blvd, Orlando, FL 32816",
    exPhone: "ex.: +1 407 555 0199", exSource: "ex.: distribuições da minha empresa operacional",
    accreditationTitle: "Qualificação do investidor — marque o que se aplica",
    accreditationWhat: "Pela lei de valores mobiliários dos EUA, uma oferta privada como esta só pode aceitar investidores “qualificados” (accredited). Este passo confirma que quem está investindo atende a um desses critérios — nada aqui é publicado; serve só para documentar a elegibilidade. Responda pensando em QUEM está investindo (a empresa, se você investe por meio de uma pessoa jurídica).",
    accreditationSub: "Autocertificação 506(b).",
    uboTitle: "Sócios com 25%+ e pessoa de controle",
    uboSub: "Exigência bancária/AML. Documento com foto será pedido para cada listado.",
    uboName: "Nome", uboPct: "Participação %", uboControl: "pessoa de controle", uboAdd: "+ adicionar sócio",
    taxTitle: "Status fiscal de quem está investindo",
    taxSub: "Refere-se à entidade ou pessoa que está investindo — NÃO aos sócios dela. Se quem investe é uma empresa americana, ela é “U.S. person” e usa o W-9, mesmo que os sócios morem fora (esses sócios são listados no passo Sócios).",
    usYes: "Quem investe é “U.S. person” (ex.: uma LLC ou corporation americana, ou um residente nos EUA) → o sistema prepara o W-9",
    usNo: "Quem investe NÃO é “U.S. person” (pessoa ou empresa estrangeira) → o sistema prepara o W-8BEN / W-8BEN-E",
    classification: "Classificação fiscal (entidades)", source: "Origem dos recursos",
    reviewTitle: "Seu pacote foi gerado — revise e assine",
    reviewSub: "Tudo preenchido com as suas respostas. Abra cada documento antes de assinar.",
    docSub: "Subscription Agreement", docQ: "Investor Questionnaire (Part III)", docJ: "Amendment & Joinder",
    generated: "✓ gerado", open: "abrir",
    signLabel: "Assinatura eletrônica — digite seu nome completo",
    consent: "Concordo em assinar eletronicamente (E-SIGN/UETA) e declaro que as informações são verdadeiras. IP, data/hora e hash dos documentos serão registrados.",
    signBtn: "Assinar e enviar ✍", signing: "Assinando…",
    back: "← Voltar", next: "Continuar →",
    prefillBanner: "Pré-preenchemos seus dados a partir do seu investimento anterior — revise cada passo antes de assinar.",
    statusTitle: "Sua admissão — acompanhamento",
    statusSub: "Você recebe e-mail a cada etapa.",
    stSigned: "Pacote assinado eletronicamente", stKyc: "Verificação KYC/AML", stAccept: "Aguardando aceite do Manager",
    stWire: "Wire instructions liberadas no portal (nunca por e-mail) + verificação por telefone",
    stMember: "Exhibit A atualizado — você é sócio e o portal abre com seu extrato",
    accepted: "Admissão aceita — bem-vindo(a)!",
    rejected: "Esta subscrição não foi aceita. Fale com o Manager.",
    missing: "Complete os passos anteriores antes de assinar:",
  },
};

const money = (n: number) =>
  "US$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function SubscriptionWizard({
  token,
  poolName,
  poolCode,
  houseCount,
  unitPrice,
  suggestedUnits,
  status,
  initialData,
  prefilled,
  prefillFresh,
  email,
  signedAt,
}: {
  token: string;
  poolName: string;
  poolCode: string;
  houseCount: number;
  unitPrice: number;
  suggestedUnits: number | null;
  status: string;
  initialData: WizardData | null;
  prefilled: boolean;
  prefillFresh: boolean;
  email: string | null;
  signedAt: string | null;
}) {
  const [lang, setLang] = useState<"en" | "pt">("pt");
  const T = DICT[lang];
  const [step, setStep] = useState(0);
  const [d, setD] = useState<WizardData>(
    initialData ?? { units: suggestedUnits ?? 50, email: email ?? "", accreditation: [], ubo: [] },
  );
  const [firstSave, setFirstSave] = useState(prefillFresh);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [signState, signAction, signPending] = useActionState<SubFormState, FormData>(
    signSubscription.bind(null, token),
    undefined,
  );
  useEffect(() => {
    if (signState?.ok) window.location.reload();
  }, [signState]);

  const isIndividual = d.type === "INDIVIDUAL";
  const steps = useMemo(() => T.step.filter((_, i) => !(i === 3 && isIndividual)), [T, isIndividual]);
  const missing = missingForSignature(d);

  if (status === "SIGNED" || status === "ACCEPTED" || status === "REJECTED") {
    const accepted = status === "ACCEPTED";
    return (
      <Shell poolName={poolName} poolCode={poolCode} lang={lang} setLang={setLang}>
        <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
          <h2 className="text-lg font-bold">{T.statusTitle}</h2>
          <p className="mb-4 text-sm text-slate-500">{T.statusSub}</p>
          {status === "REJECTED" ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{T.rejected}</p>
          ) : (
            <ul className="space-y-0 text-sm">
              {[
                { label: `${T.stSigned}${signedAt ? ` — ${signedAt}` : ""}`, done: true },
                { label: T.stKyc, done: accepted },
                { label: T.stAccept, done: accepted, current: !accepted },
                { label: T.stWire, done: false },
                { label: T.stMember, done: accepted },
              ].map((s, i) => (
                <li key={i} className="flex items-center gap-3 border-b border-dashed border-slate-200 py-2.5 last:border-0">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      s.done ? "bg-green-100 text-green-700" : s.current ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {s.done ? "✓" : i + 1}
                  </span>
                  {s.label}
                </li>
              ))}
            </ul>
          )}
          {accepted && <p className="mt-4 rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-700">{T.accepted}</p>}
        </div>
      </Shell>
    );
  }

  const stepKey = steps[step];

  async function saveAndGo(delta: number) {
    setSaveError(null);
    if (delta > 0) {
      const res = await updateWizardData(token, d, firstSave ? true : undefined);
      if (res?.error) {
        setSaveError(res.error);
        return;
      }
      setFirstSave(false);
    }
    setStep((s) => Math.max(0, Math.min(steps.length - 1, s + delta)));
  }

  const input = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-semibold text-slate-600";
  const chk = "flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 p-3 text-sm hover:border-slate-400";

  return (
    <Shell poolName={poolName} poolCode={poolCode} lang={lang} setLang={setLang}>
      {prefilled && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          ⚠ {T.prefillBanner}
        </div>
      )}
      <div className="mb-4 flex gap-1.5">
        {steps.map((_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded ${i < step ? "bg-slate-800" : i === step ? "bg-amber-600" : "bg-slate-200"}`} />
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <span className="mb-2 inline-block rounded-full bg-slate-100 px-3 py-0.5 text-[11px] font-bold text-slate-700">
          {step + 1} · {stepKey}
        </span>

        {step === 0 && (
          <div>
            <h2 className="text-lg font-bold">{T.invite} {poolCode}</h2>
            <p className="mb-4 text-sm text-slate-500">{poolName} · {houseCount} homes</p>
            <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5">
              <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                {/* editar por units */}
                <div>
                  <label className={label}>{T.unitsField}</label>
                  <div className="flex items-center gap-2">
                    <button type="button" className="h-9 w-9 shrink-0 rounded-lg border border-slate-200 bg-white text-lg"
                      onClick={() => setD({ ...d, units: Math.max(1, Math.floor(d.units ?? 1) - 1) })}>−</button>
                    <input type="number" min={1} step={1} value={d.units ?? ""}
                      onChange={(e) => { const n = Math.floor(Number(e.target.value)); setD({ ...d, units: e.target.value === "" ? undefined : n > 0 ? n : 1 }); }}
                      className="h-11 w-24 rounded-lg border border-slate-300 bg-white text-center text-xl font-extrabold" />
                    <button type="button" className="h-9 w-9 shrink-0 rounded-lg border border-slate-200 bg-white text-lg"
                      onClick={() => setD({ ...d, units: Math.floor(d.units ?? 0) + 1 })}>+</button>
                  </div>
                </div>
                {/* editar por valor em US$ (espelha units, 1 unit = unitPrice) */}
                <div>
                  <label className={label}>{T.amountField}</label>
                  <div className="flex items-center gap-1">
                    <span className="text-lg font-semibold text-slate-400">US$</span>
                    <input type="number" min={0} step={unitPrice} value={d.units != null ? Math.round(d.units * unitPrice) : ""}
                      onChange={(e) => { const v = Number(e.target.value); setD({ ...d, units: e.target.value === "" ? undefined : Math.max(1, Math.round(v / unitPrice)) }); }}
                      className="h-11 w-40 rounded-lg border border-slate-300 bg-white px-2 text-right text-xl font-extrabold text-slate-800" />
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-2xl font-extrabold text-[#1f3a5f]">{money((d.units ?? 0) * unitPrice)}</div>
                  <div className="text-[11px] text-slate-500">{T.commitment}</div>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">{T.unitsHint} {money(unitPrice)}.</p>
            </div>
            <p className="rounded-lg bg-slate-100 px-3.5 py-2.5 text-xs text-slate-600">💡 {T.callNote}</p>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="text-lg font-bold">{T.identityTitle}</h2>
            <p className="mb-4 text-sm text-slate-500">{T.identitySub}</p>
            <div className="mb-3">
              <label className={label}>{T.type}</label>
              <select className={input} value={d.type ?? ""} onChange={(e) => setD({ ...d, type: (e.target.value || undefined) as WizardData["type"] })}>
                <option value="">—</option>
                {INVESTOR_TYPES.map((o) => <option key={o.key} value={o.key}>{o[lang]}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label className={label}>{T.legalName}</label>
                <input className={input} placeholder={T.exName} value={d.legalName ?? ""} onChange={(e) => setD({ ...d, legalName: e.target.value })} /></div>
              <div><label className={label}>{T.jurisdiction}</label>
                <input className={input} placeholder={isIndividual ? T.exJurInd : T.exJurEntity} value={d.jurisdiction ?? ""} onChange={(e) => setD({ ...d, jurisdiction: e.target.value })} /></div>
              <div><label className={label}>{T.tin}</label>
                <input className={input} placeholder={isIndividual ? T.exTinInd : T.exTinEntity} value={d.tin ?? ""} onChange={(e) => setD({ ...d, tin: e.target.value })} /></div>
              <div><label className={label}>{T.email}</label>
                <input className={input} placeholder="nome@email.com" value={d.email ?? ""} onChange={(e) => setD({ ...d, email: e.target.value })} /></div>
              <div><label className={label}>{T.phone}</label>
                <input className={input} placeholder={T.exPhone} value={d.phone ?? ""} onChange={(e) => setD({ ...d, phone: e.target.value })} /></div>
            </div>
            <div className="mt-3"><label className={label}>{T.address}</label>
              <input className={input} placeholder={T.exAddr} value={d.address ?? ""} onChange={(e) => setD({ ...d, address: e.target.value })} /></div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-lg font-bold">{T.accreditationTitle}</h2>
            <p className="mb-3 text-sm text-slate-500">{T.accreditationSub}</p>
            <p className="mb-4 rounded-lg bg-blue-50 px-3.5 py-3 text-xs leading-relaxed text-slate-700">ℹ️ {T.accreditationWhat}</p>
            <div className="space-y-2">
              {ACCREDITATION_OPTIONS.filter((o) => o.scope === "both" || o.scope === (isIndividual ? "individual" : "entity")).map((o) => (
                <label key={o.key} className={chk}>
                  <input type="checkbox" className="mt-0.5" checked={d.accreditation?.includes(o.key) ?? false}
                    onChange={(e) => {
                      const cur = new Set(d.accreditation ?? []);
                      if (e.target.checked) cur.add(o.key); else cur.delete(o.key);
                      setD({ ...d, accreditation: [...cur] });
                    }} />
                  {o[lang]}
                </label>
              ))}
            </div>
          </div>
        )}

        {step === 3 && !isIndividual && (
          <div>
            <h2 className="text-lg font-bold">{T.uboTitle}</h2>
            <p className="mb-4 text-sm text-slate-500">{T.uboSub}</p>
            {(d.ubo?.length ? d.ubo : [{ name: "", pct: "", control: true } as UboRow]).map((r, i) => (
              <div key={i} className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_170px]">
                <input className={input} placeholder={T.uboName} value={r.name}
                  onChange={(e) => setUbo(i, { ...r, name: e.target.value })} />
                <input className={input} placeholder={T.uboPct} value={r.pct}
                  onChange={(e) => setUbo(i, { ...r, pct: e.target.value })} />
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={r.control} onChange={(e) => setUbo(i, { ...r, control: e.target.checked })} />
                  {T.uboControl}
                </label>
              </div>
            ))}
            <button type="button" className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
              onClick={() => setD({ ...d, ubo: [...(d.ubo ?? [{ name: "", pct: "", control: true }]), { name: "", pct: "", control: false }] })}>
              {T.uboAdd}
            </button>
          </div>
        )}

        {((step === 3 && isIndividual) || (step === 4 && !isIndividual)) && (
          <div>
            <h2 className="text-lg font-bold">{T.taxTitle}</h2>
            <p className="mb-4 text-sm text-slate-500">{T.taxSub}</p>
            <label className={chk}>
              <input type="radio" name="us" checked={d.usPerson === true} onChange={() => setD({ ...d, usPerson: true })} />
              {T.usYes}
            </label>
            <label className={`${chk} mt-2`}>
              <input type="radio" name="us" checked={d.usPerson === false} onChange={() => setD({ ...d, usPerson: false })} />
              {T.usNo}
            </label>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {!isIndividual && (
                <div><label className={label}>{T.classification}</label>
                  <select className={input} value={d.taxClassification ?? ""} onChange={(e) => setD({ ...d, taxClassification: e.target.value || undefined })}>
                    <option value="">—</option>
                    <option>Partnership</option><option>Disregarded entity</option>
                    <option>C corporation</option><option>S corporation</option>
                  </select></div>
              )}
              <div><label className={label}>{T.source}</label>
                <input className={input} placeholder={T.exSource} value={d.sourceOfFunds ?? ""} onChange={(e) => setD({ ...d, sourceOfFunds: e.target.value })} /></div>
            </div>
          </div>
        )}

        {step === steps.length - 1 && (
          <div>
            <h2 className="text-lg font-bold">{T.reviewTitle}</h2>
            <p className="mb-4 text-sm text-slate-500">{T.reviewSub}</p>
            <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {[
                { k: T.docSub, href: `/subscribe/${token}/doc/subscription`, sub: `${d.units ?? 0} Units · ${money((d.units ?? 0) * unitPrice)}` },
                { k: T.docQ, href: `/subscribe/${token}/doc/subscription`, sub: d.legalName ?? "" },
                { k: T.docJ, href: `/subscribe/${token}/doc/joinder`, sub: "Exhibit B — Operating Agreement" },
              ].map((doc) => (
                <a key={doc.k} href={doc.href} target="_blank" rel="noreferrer"
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs hover:border-slate-400">
                  <b className="block text-[13px] text-slate-800">{doc.k}</b>
                  <span className="text-slate-500">{doc.sub}</span>
                  <span className="mt-1 block font-bold text-green-700">{T.generated} · {T.open} ↗</span>
                </a>
              ))}
            </div>
            {missing.length > 0 && (
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {T.missing} {missing.join(", ")}
              </p>
            )}
            <form action={signAction} className="rounded-xl border-2 border-slate-800 bg-slate-50/50 p-4">
              <label className="text-sm font-semibold">{T.signLabel}</label>
              <input name="signName" className="my-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-xl" style={{ fontFamily: "cursive" }} />
              <label className="flex items-start gap-2 text-xs text-slate-600">
                <input type="checkbox" name="consent" className="mt-0.5" /> {T.consent}
              </label>
              {signState?.error && <p className="mt-2 text-sm text-red-600">{signState.error}</p>}
              <button disabled={signPending || missing.length > 0}
                className="mt-3 rounded-lg bg-slate-800 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                {signPending ? T.signing : T.signBtn}
              </button>
            </form>
          </div>
        )}
      </div>

      {saveError && <p className="mt-3 text-sm text-red-600">{saveError}</p>}
      <div className="mt-5 flex justify-between">
        <button type="button" onClick={() => saveAndGo(-1)} style={{ visibility: step === 0 ? "hidden" : "visible" }}
          className="rounded-lg border border-slate-200 bg-white px-5 py-2 text-sm font-semibold">
          {T.back}
        </button>
        {step < steps.length - 1 && (
          <button type="button" onClick={() => saveAndGo(1)}
            className="rounded-lg bg-slate-800 px-6 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            {T.next}
          </button>
        )}
      </div>
    </Shell>
  );

  function setUbo(i: number, row: UboRow) {
    const cur = d.ubo?.length ? [...d.ubo] : [{ name: "", pct: "", control: true }];
    cur[i] = row;
    setD({ ...d, ubo: cur });
  }
}

function Shell({
  poolName, poolCode, lang, setLang, children,
}: {
  poolName: string; poolCode: string; lang: "en" | "pt"; setLang: (l: "en" | "pt") => void; children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/vixus-logo.png" alt="Vixus Global" className="h-7 w-auto" />
          <div className="h-8 w-px bg-slate-200" />
          <div>
            <div className="text-sm font-bold">{poolName}</div>
            <div className="text-[11px] text-slate-500">Investor onboarding · {poolCode}</div>
          </div>
        </div>
        <div className="text-xs text-slate-500">
          <button onClick={() => setLang("en")} className={lang === "en" ? "font-bold text-slate-800" : ""}>EN</button>
          {" | "}
          <button onClick={() => setLang("pt")} className={lang === "pt" ? "font-bold text-slate-800" : ""}>PT</button>
        </div>
      </header>
      {children}
    </main>
  );
}
