"use server";

import { redirect } from "next/navigation";
import { authenticate } from "@/lib/auth";
import { createSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Введите email и пароль" };
  }

  const user = await authenticate(email, password);
  if (!user) {
    return { error: "Неверный email или пароль" };
  }

  await createSession({
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    permissions: user.permissions,
  });

  await logAudit({
    userId: user.id,
    entityType: "session",
    entityId: user.id,
    action: "login",
  });

  redirect("/dashboard");
}
