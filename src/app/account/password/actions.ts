"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSession, requireSession } from "@/lib/session";
import { hashPassword, verifyPassword, getUserPermissions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { validateNewPassword } from "@/lib/password-policy";
import { clearLoginFailures, loginLockedMinutes, recordLoginFailure } from "@/lib/login-throttle";

const back = (message: string): never => redirect(`/account/password?error=${encodeURIComponent(message)}`);

/**
 * Смена собственного пароля: текущий пароль (с той же защитой от подбора, что
 * у входа), новый по требованиям (password-policy). После смены все прежние
 * сессии пользователя недействительны, текущая выдаётся заново.
 */
export async function changeOwnPasswordAction(formData: FormData) {
  const session = await requireSession();
  const current = String(formData.get("currentPassword") ?? "");
  const password = String(formData.get("newPassword") ?? "");
  const repeat = String(formData.get("repeatPassword") ?? "");

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  const locked = await loginLockedMinutes(user.email);
  if (locked > 0) back(`Слишком много неверных попыток. Попробуйте через ${locked} мин.`);
  if (!(await verifyPassword(current, user.passwordHash))) {
    await recordLoginFailure(user.email);
    back("Текущий пароль указан неверно");
  }
  const problem = validateNewPassword({ password, repeat, email: user.email, current });
  if (problem) back(problem);

  const changedAt = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), mustChangePassword: false, passwordChangedAt: changedAt },
  });
  await clearLoginFailures(user.email);
  // A fresh session for this browser; all others were issued before the change and stop working.
  await createSession({ userId: user.id, email: user.email, fullName: user.fullName, permissions: await getUserPermissions(user.id) });
  await logAudit({ userId: user.id, entityType: "user", entityId: user.id, action: "change_own_password" });
  redirect(session.mustChangePassword ? "/dashboard" : "/account/password?done=1");
}

/** Завершить сеансы на других устройствах (потерян ноутбук, вход с чужого компьютера); этот сеанс остаётся. */
export async function endOtherSessionsAction() {
  const session = await requireSession();
  const user = await prisma.user.update({ where: { id: session.userId }, data: { sessionsRevokedAt: new Date() } });
  // A fresh session for this browser: issued after the cut-off, it stays valid.
  await createSession({ userId: user.id, email: user.email, fullName: user.fullName, permissions: await getUserPermissions(user.id) });
  await logAudit({ userId: user.id, entityType: "user", entityId: user.id, action: "end_other_sessions" });
  redirect("/account/password?sessions=1");
}
