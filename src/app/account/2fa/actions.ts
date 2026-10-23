"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSessionForAccountSetup } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { setFlash } from "@/lib/flash";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import { generateTotpSecret, verifyTotp } from "@/lib/mfa/totp";
import { generateRecoveryCodes, hashRecoveryCode } from "@/lib/mfa/recovery";
import { checkSecondFactor } from "@/lib/mfa/verify";
import { mfaRequiredFor } from "@/lib/mfa/policy";
import { getMfaPolicy } from "@/lib/mfa/settings";
import { clearLoginFailures, lockedMinutesFor, recordLoginFailure, MAX_FAILURES } from "@/lib/login-throttle";

const PAGE = "/account/2fa";
const back = (kind: "error" | "notice", message: string): never => redirect(`${PAGE}?${kind}=${encodeURIComponent(message)}`);
const mfaKey = (userId: string) => `mfa:${userId}`;

/** Своя учётная запись; временный пароль сначала заменяется — до него код не подключается. */
async function ownAccount() {
  const session = await requireSessionForAccountSetup();
  if (session.mustChangePassword) redirect("/account/password");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  return { session, user };
}

/** Подбор кода на этой странице ограничен так же, как при входе. */
async function guardGuessing(userId: string) {
  const failures = await prisma.loginFailure.findMany({
    where: { email: mfaKey(userId), createdAt: { gte: new Date(Date.now() - 30 * 60_000) } },
    select: { createdAt: true },
  });
  const locked = lockedMinutesFor(failures.map((f) => f.createdAt), new Date(), MAX_FAILURES);
  if (locked > 0) back("error", `Слишком много неверных кодов. Попробуйте через ${locked} мин.`);
}

export async function startMfaSetupAction() {
  const { user } = await ownAccount();
  if (user.totpEnabledAt) back("notice", "Вход с кодом уже подключён");
  await prisma.user.update({ where: { id: user.id }, data: { totpPendingSecretEnc: encryptSecret(generateTotpSecret()) } });
  redirect(PAGE);
}

export async function cancelMfaSetupAction() {
  const { user } = await ownAccount();
  await prisma.user.update({ where: { id: user.id }, data: { totpPendingSecretEnc: null } });
  redirect(PAGE);
}

/** Первый верный код подтверждает, что телефон настроен: вход с кодом включается, выдаются резервные коды. */
export async function confirmMfaSetupAction(formData: FormData) {
  const { user } = await ownAccount();
  if (user.totpEnabledAt) back("notice", "Вход с кодом уже подключён");
  if (!user.totpPendingSecretEnc) back("error", "Начните подключение заново");
  await guardGuessing(user.id);
  const secret = decryptSecret(user.totpPendingSecretEnc!);
  const step = verifyTotp(secret, String(formData.get("code") ?? ""), new Date(), null);
  if (step === null) {
    await recordLoginFailure(mfaKey(user.id));
    back("error", "Код не подошёл. Проверьте, что время на телефоне установлено автоматически, и введите текущий код");
  }
  const codes = generateRecoveryCodes();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpSecretEnc: user.totpPendingSecretEnc,
      totpPendingSecretEnc: null,
      totpEnabledAt: new Date(),
      totpLastStep: step,
      totpRecoveryHashes: codes.map(hashRecoveryCode),
    },
  });
  await clearLoginFailures(mfaKey(user.id));
  await logAudit({ userId: user.id, entityType: "user", entityId: user.id, action: "mfa_enable" });
  await setFlash("recoveryCodes", codes.join(" "));
  redirect(`${PAGE}?enabled=1`);
}

/** Новые резервные коды (старые перестают действовать) — по текущему коду из приложения. */
export async function regenerateRecoveryCodesAction(formData: FormData) {
  const { user } = await ownAccount();
  if (!user.totpEnabledAt) back("error", "Вход с кодом не подключён");
  await guardGuessing(user.id);
  const check = await checkSecondFactor(user, String(formData.get("code") ?? ""));
  if (!check.ok || check.method !== "totp") {
    await recordLoginFailure(mfaKey(user.id));
    back("error", "Введите текущий код из приложения (не резервный)");
  }
  const codes = generateRecoveryCodes();
  await prisma.user.update({ where: { id: user.id }, data: { totpRecoveryHashes: codes.map(hashRecoveryCode) } });
  await logAudit({ userId: user.id, entityType: "user", entityId: user.id, action: "mfa_recovery_codes" });
  await setFlash("recoveryCodes", codes.join(" "));
  redirect(`${PAGE}?enabled=1`);
}

/** Отключить вход с кодом — по коду из приложения или резервному; если он обязателен, отключить нельзя. */
export async function disableMfaAction(formData: FormData) {
  const { session, user } = await ownAccount();
  if (!user.totpEnabledAt) back("notice", "Вход с кодом и так выключен");
  if (mfaRequiredFor(await getMfaPolicy(), session.permissions)) {
    back("error", "Вход с кодом для вас обязателен — отключить его нельзя. Потеряли телефон — подключите заново на новом");
  }
  await guardGuessing(user.id);
  const check = await checkSecondFactor(user, String(formData.get("code") ?? ""));
  if (!check.ok) {
    await recordLoginFailure(mfaKey(user.id));
    back("error", "Код не подошёл");
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecretEnc: null, totpPendingSecretEnc: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryHashes: [] },
  });
  await logAudit({ userId: user.id, entityType: "user", entityId: user.id, action: "mfa_disable" });
  back("notice", "Вход с кодом отключён — теперь для входа достаточно пароля");
}
