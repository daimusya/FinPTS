"use server";

import { redirect } from "next/navigation";
import { authenticate } from "@/lib/auth";
import { createSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { clearLoginFailures, loginLockedMinutes, recordLoginFailure } from "@/lib/login-throttle";

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

  // Protection against password guessing: the password is not even checked while the address is locked.
  const locked = await loginLockedMinutes(email);
  if (locked > 0) {
    return { error: `Слишком много неудачных попыток входа. Попробуйте через ${locked} мин.` };
  }

  const user = await authenticate(email, password);
  if (!user) {
    await recordLoginFailure(email);
    return { error: "Неверный email или пароль" };
  }
  await clearLoginFailures(email);

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
