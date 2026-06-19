"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { UserRole } from "@prisma/client";

export type UserFormState = { error?: string } | undefined;

const ROLES = ["ADMIN", "BOOKKEEPER", "VIEWER"];

async function requireAdmin() {
  const session = await auth();
  const user = session?.user;
  if (!user || (user as { role?: string }).role !== "ADMIN") {
    throw new Error("Forbidden — admin only.");
  }
  return user as { id: string; role: string };
}

export async function createUser(
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  await requireAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "VIEWER");
  const password = String(formData.get("password") ?? "");

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "E-mail inválido." };
  if (password.length < 8) return { error: "A senha precisa ter ao menos 8 caracteres." };
  if (!ROLES.includes(role)) return { error: "Papel inválido." };

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return { error: "Já existe um usuário com esse e-mail." };

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { email, name: name || null, role: role as UserRole, passwordHash },
  });
  revalidatePath("/admin/users");
  return undefined;
}

export async function setUserRole(formData: FormData): Promise<void> {
  const me = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!id || !ROLES.includes(role)) return;
  if (id === me.id && role !== "ADMIN") return; // não rebaixa a si mesmo (evita travar o acesso)
  await prisma.user.update({ where: { id }, data: { role: role as UserRole } });
  revalidatePath("/admin/users");
}

export async function resetUserPassword(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!id || password.length < 8) return;
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id }, data: { passwordHash } });
  revalidatePath("/admin/users");
}

export async function deleteUser(formData: FormData): Promise<void> {
  const me = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id || id === me.id) return; // não deleta a si mesmo
  await prisma.user.delete({ where: { id } });
  revalidatePath("/admin/users");
}
