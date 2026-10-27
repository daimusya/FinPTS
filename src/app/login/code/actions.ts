"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSession } from "@/lib/session";
import { getUserPermissions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { clearPendingLogin, readPendingLogin } from "@/lib/mfa/pending-login";
import { checkSecondFactor } from "@/lib/mfa/verify";
import { clearLoginFailures, clientIp, ipKey, ipLockedMinutes, lockedMinutesFor, recordLoginFailure, MAX_FAILURES } from "@/lib/login-throttle";
import { prisma } from "@/lib/db";
import { rememberSignInDevice } from "@/lib/known-devices";

export interface CodeState {
  error?: string;
}

/** Ключ блокировки подбора кода — свой у каждого пользователя. */
const mfaKey = (userId: string) => `mfa:${userId}`;

/**
 * Второй шаг входа: код из приложения или резервный код. Те же правила против
 * подбора, что у пароля: 5 неверных кодов за 15 минут — пауза, и общий предел
 * для одного компьютера.
 */
export async function verifyLoginCodeAction(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const user = await readPendingLogin();
  if (!user) redirect("/login?expired=1");
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "Введите код из приложения" };

  const store = await headers();
  const ip = clientIp(store.get("x-forwarded-for"), store.get("x-real-ip"));
  const failures = await prisma.loginFailure.findMany({
    where: { email: mfaKey(user!.id), createdAt: { gte: new Date(Date.now() - 30 * 60_000) } },
    select: { createdAt: true },
  });
  const locked = Math.max(lockedMinutesFor(failures.map((f) => f.createdAt), new Date(), MAX_FAILURES), await ipLockedMinutes(ip));
  if (locked > 0) return { error: `Слишком много неверных кодов. Попробуйте через ${locked} мин.` };

  const result = await checkSecondFactor(user!, code);
  if (!result.ok && result.unreadable) {
    return {
      error:
        "Вход с кодом нужно подключить заново: его ключ сохранён при другом AUTH_SECRET. Войдите по резервному коду или попросите администратора сбросить вход с кодом",
    };
  }
  if (!result.ok) {
    await recordLoginFailure(mfaKey(user!.id));
    if (ip) await recordLoginFailure(ipKey(ip));
    return { error: "Код не подошёл. Введите текущий код из приложения (он меняется каждые 30 секунд) или резервный код" };
  }

  await clearLoginFailures(mfaKey(user!.id));
  await clearPendingLogin();
  await createSession({ userId: user!.id, email: user!.email, fullName: user!.fullName, permissions: await getUserPermissions(user!.id) });
  await rememberSignInDevice(user!.id);
  await logAudit({ userId: user!.id, entityType: "session", entityId: user!.id, action: "login", after: { secondFactor: result.method } as never });
  if (result.method === "recovery") {
    await notify([user!.id], {
      title: "Вход по резервному коду",
      body: `Вы вошли по резервному коду — осталось ${result.recoveryLeft}. Если это были не вы, смените пароль. Если телефон потерян, подключите вход с кодом заново.`,
      link: "/account/2fa",
    });
  }
  redirect("/dashboard");
}

/** «Это не я / начать заново»: забыть первый шаг. */
export async function cancelLoginCodeAction() {
  await clearPendingLogin();
  redirect("/login");
}
