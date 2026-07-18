"use client";

import { useActionState, useState } from "react";
import {
  addContribution,
  addDistribution,
  addMember,
  transferUnits,
  type FormState,
} from "@/lib/actions/pools";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";
const buttonClass =
  "rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60";

export type OwnerOption = { value: string; label: string }; // "party:<id>" | "company:<id>"
export type MemberOption = { id: string; name: string; role: string };
export type HouseOption = { id: string; address: string };

// Adiciona sócio: Party ou Company num select único (padrão do Ownership).
export function AddMemberForm({ poolId, owners }: { poolId: string; owners: OwnerOption[] }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    addMember.bind(null, poolId),
    undefined,
  );
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="min-w-64 flex-1">
        <label htmlFor="member-owner" className={labelClass}>
          Investor (company or person)
        </label>
        <select id="member-owner" name="owner" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Select…
          </option>
          {owners.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="w-36">
        <label htmlFor="member-role" className={labelClass}>
          Role
        </label>
        <select id="member-role" name="role" defaultValue="INVESTOR" className={inputClass}>
          <option value="INVESTOR">Investor</option>
          <option value="MANAGER">Manager</option>
        </select>
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Adding…" : "+ Add member"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

// Aporte (só na janela de captação): valor → units pelo preço da unit.
// defaultMemberId: atalho "+ aporte" da linha do cap table pré-seleciona o sócio.
export function AddContributionForm({
  poolId,
  members,
  defaultMemberId,
  distOptions = [],
}: {
  poolId: string;
  members: MemberOption[];
  defaultMemberId?: string;
  // extrato do investidor (regra da carteira): rolagem direta escolhe a distribuição reusada
  distOptions?: Array<{ id: string; label: string }>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    addContribution.bind(null, poolId),
    undefined,
  );
  const [classification, setClassification] = useState("AUTO");
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="min-w-56 flex-1">
        <label htmlFor="contrib-member" className={labelClass}>
          Member
        </label>
        <select
          id="contrib-member"
          name="memberId"
          required
          defaultValue={defaultMemberId ?? ""}
          className={inputClass}
        >
          <option value="" disabled>
            Select…
          </option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="w-36">
        <label htmlFor="contrib-amount" className={labelClass}>
          Amount
        </label>
        <input id="contrib-amount" name="amount" required className={inputClass} />
      </div>
      <div className="w-40">
        <label htmlFor="contrib-date" className={labelClass}>
          Date
        </label>
        <input id="contrib-date" name="date" type="date" required className={inputClass} />
      </div>
      <div className="min-w-40 flex-1">
        <label htmlFor="contrib-memo" className={labelClass}>
          Memo
        </label>
        <input id="contrib-memo" name="memo" className={inputClass} />
      </div>
      {/* classificação do dinheiro (regra da carteira, 19/07): automática | rolagem | novo */}
      <div className="w-52">
        <label htmlFor="contrib-class" className={labelClass}>
          Classificação do dinheiro
        </label>
        <select
          id="contrib-class"
          name="classification"
          value={classification}
          onChange={(e) => setClassification(e.target.value)}
          className={inputClass}
        >
          <option value="AUTO">Automática (carteira)</option>
          <option value="ROLLOVER" disabled={distOptions.length === 0}>
            ↩ Reuso de distribuição…
          </option>
          <option value="NEW">Forçar dinheiro novo</option>
        </select>
      </div>
      {classification === "ROLLOVER" && (
        <div className="min-w-56 flex-1">
          <label htmlFor="contrib-rollover" className={labelClass}>
            Distribuição reusada
          </label>
          <select id="contrib-rollover" name="rolloverOfDistributionId" required className={inputClass}>
            <option value="">Selecione…</option>
            {distOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Adding…" : "+ Contribution"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

// Transferência de units (ex.: investidor compra espaço da Vixus depois do corte).
export function TransferUnitsForm({
  poolId,
  members,
}: {
  poolId: string;
  members: MemberOption[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    transferUnits.bind(null, poolId),
    undefined,
  );
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="min-w-48 flex-1">
        <label htmlFor="transfer-from" className={labelClass}>
          From (sells units)
        </label>
        <select id="transfer-from" name="fromMemberId" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Select…
          </option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.role === "MANAGER" ? " (manager)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-48 flex-1">
        <label htmlFor="transfer-to" className={labelClass}>
          To (buys units)
        </label>
        <select id="transfer-to" name="toMemberId" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Select…
          </option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="w-36">
        <label htmlFor="transfer-amount" className={labelClass}>
          Amount
        </label>
        <input id="transfer-amount" name="amount" required className={inputClass} />
      </div>
      <div className="w-40">
        <label htmlFor="transfer-date" className={labelClass}>
          Date
        </label>
        <input id="transfer-date" name="date" type="date" required className={inputClass} />
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Transferring…" : "Transfer units"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

// Distribuição (devolução de capital ou lucro) — rateada pro rata por units no server.
export function AddDistributionForm({
  poolId,
  houses,
}: {
  poolId: string;
  houses: HouseOption[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    addDistribution.bind(null, poolId),
    undefined,
  );
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="w-44">
        <label htmlFor="dist-kind" className={labelClass}>
          Kind
        </label>
        <select id="dist-kind" name="kind" defaultValue="RETURN_OF_CAPITAL" className={inputClass}>
          <option value="RETURN_OF_CAPITAL">Return of capital</option>
          <option value="PROFIT">Profit</option>
        </select>
      </div>
      <div className="w-36">
        <label htmlFor="dist-amount" className={labelClass}>
          Total amount
        </label>
        <input id="dist-amount" name="totalAmount" required className={inputClass} />
      </div>
      <div className="w-40">
        <label htmlFor="dist-date" className={labelClass}>
          Date
        </label>
        <input id="dist-date" name="date" type="date" required className={inputClass} />
      </div>
      <div className="min-w-48 flex-1">
        <label htmlFor="dist-house" className={labelClass}>
          From sale of (optional)
        </label>
        <select id="dist-house" name="houseId" defaultValue="" className={inputClass}>
          <option value="">—</option>
          {houses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.address}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Distributing…" : "+ Distribution"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
