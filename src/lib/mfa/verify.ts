import { prisma } from "@/lib/db";
import { tryDecryptSecret } from "@/lib/crypto/secret-box";
import { verifyTotp } from "@/lib/mfa/totp";
import { consumeRecoveryCode, looksLikeRecoveryCode } from "@/lib/mfa/recovery";

/**
 * Проверить код второго шага пользователя и сразу отметить его
 * использованным: код из приложения — запоминается его интервал (второй раз
 * тот же код не пройдёт), резервный — вычёркивается. Запись условная, поэтому
 * один код, введённый одновременно в двух окнах, сработает только в одном.
 */
export async function checkSecondFactor(
  user: { id: string; totpSecretEnc: string | null; totpLastStep: number | null; totpRecoveryHashes: string[] },
  code: string,
  now: Date = new Date(),
): Promise<{ ok: true; method: "totp" | "recovery"; recoveryLeft: number } | { ok: false; unreadable?: true }> {
  if (!user.totpSecretEnc) return { ok: false };
  if (looksLikeRecoveryCode(code)) {
    const left = consumeRecoveryCode(user.totpRecoveryHashes, code);
    if (!left) return { ok: false };
    const saved = await prisma.user.updateMany({
      where: { id: user.id, totpRecoveryHashes: { equals: user.totpRecoveryHashes } },
      data: { totpRecoveryHashes: left },
    });
    return saved.count === 1 ? { ok: true, method: "recovery", recoveryLeft: left.length } : { ok: false };
  }
  // Stored under another AUTH_SECRET (changed without re-encryption): no code can match — say so instead of failing.
  const secret = tryDecryptSecret(user.totpSecretEnc);
  if (secret === null) return { ok: false, unreadable: true };
  const step = verifyTotp(secret, code, now, user.totpLastStep);
  if (step === null) return { ok: false };
  const saved = await prisma.user.updateMany({
    where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  });
  return saved.count === 1 ? { ok: true, method: "totp", recoveryLeft: user.totpRecoveryHashes.length } : { ok: false };
}
