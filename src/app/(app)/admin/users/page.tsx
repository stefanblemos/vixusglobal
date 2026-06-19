import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { UserCreateForm } from "@/components/user-create-form";
import { setUserRole, deleteUser } from "@/lib/actions/users";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  BOOKKEEPER: "Bookkeeper",
  VIEWER: "Viewer",
};

export default async function UsersPage() {
  const session = await auth();
  const me = session?.user as { id?: string; role?: string } | undefined;
  if (me?.role !== "ADMIN") redirect("/"); // backstop (o proxy já bloqueia /admin p/ não-admin)

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: [{ role: "asc" }, { email: "asc" }],
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Users &amp; access</h1>
        <p className="text-sm text-slate-500">
          Who can sign in and what they can do. <span className="font-medium">Admin</span>: full
          access plus user management. <span className="font-medium">Bookkeeper</span>: view and edit
          data. <span className="font-medium">Viewer</span>: read-only.
        </p>
      </div>

      <UserCreateForm />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Created</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => {
              const isMe = u.id === me?.id;
              return (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-700">
                      {u.email ?? "—"}
                      {isMe && <span className="ml-1 text-xs text-slate-400">(you)</span>}
                    </div>
                    {u.name && <div className="text-xs text-slate-400">{u.name}</div>}
                  </td>
                  <td className="px-4 py-2">
                    <form action={setUserRole} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={u.id} />
                      <select
                        name="role"
                        defaultValue={u.role}
                        className="rounded border border-slate-200 px-2 py-1 text-xs"
                      >
                        <option value="ADMIN">Admin</option>
                        <option value="BOOKKEEPER">Bookkeeper</option>
                        <option value="VIEWER">Viewer</option>
                      </select>
                      <button className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                        set
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {u.createdAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {!isMe && (
                      <form action={deleteUser}>
                        <input type="hidden" name="id" value={u.id} />
                        <button className="text-xs text-slate-300 hover:text-red-600">Remove</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Current role label: {ROLE_LABEL[me?.role ?? ""] ?? me?.role}. You can&rsquo;t remove or
        downgrade your own account, to avoid locking yourself out.
      </p>
    </div>
  );
}
