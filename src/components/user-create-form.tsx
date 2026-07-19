"use client";

import { useActionState } from "react";
import { createUser, type UserFormState } from "@/lib/actions/users";

const input =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#8DC63F] focus:ring-2 focus:ring-[#8DC63F]/30";

export function UserCreateForm() {
  const [state, action, pending] = useActionState<UserFormState, FormData>(createUser, undefined);

  return (
    <form action={action} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <div className="text-sm font-medium text-slate-700">Add a user</div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <input name="email" type="email" required placeholder="Email" className={`${input} md:col-span-2`} />
        <input name="name" placeholder="Name (optional)" className={input} />
        <select name="role" defaultValue="VIEWER" className={input}>
          <option value="ADMIN">Admin — full access + users</option>
          <option value="OPERATOR">Operator — operate pools/investments</option>
          <option value="BOOKKEEPER">Bookkeeper — view &amp; edit data</option>
          <option value="VIEWER">Viewer — read only</option>
          <option value="INVESTOR">Investor — investor portal only</option>
        </select>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          placeholder="Temp password (min 8)"
          className={`${input} md:col-span-2`}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-50 md:col-span-2"
        >
          {pending ? "Creating…" : "Create user"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <p className="text-xs text-slate-400">
        The user signs in with this email and temporary password — ask them to change it later.
      </p>
    </form>
  );
}
