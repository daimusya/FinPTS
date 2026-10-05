/**
 * Требования к собственному паролю пользователя и действительность сессии
 * после смены пароля. Чистые функции — проверяются тестами.
 */
export const MIN_PASSWORD_LENGTH = 10;

export function validateNewPassword(input: { password: string; repeat: string; email: string; current?: string }): string | null {
  const { password } = input;
  if (password.length < MIN_PASSWORD_LENGTH) return `Пароль — не короче ${MIN_PASSWORD_LENGTH} символов`;
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return "В пароле нужны и буквы, и цифры";
  if (password !== input.repeat) return "Пароль и повтор не совпадают";
  const local = input.email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && password.toLowerCase().includes(local)) return "Пароль не должен содержать вашу почту";
  if (input.current !== undefined && password === input.current) return "Новый пароль совпадает с текущим — придумайте другой";
  return null;
}

/**
 * Сессия выдана раньше, чем пароль меняли или сбрасывали, — недействительна
 * (iat — секунды выдачи куки). Сессия, выданная в ту же секунду (сразу после
 * смены), действительна.
 */
export function sessionIssuedBeforePasswordChange(issuedAtSeconds: number | undefined, passwordChangedAt: Date | null): boolean {
  if (!passwordChangedAt) return false;
  if (typeof issuedAtSeconds !== "number") return true;
  return issuedAtSeconds < Math.floor(passwordChangedAt.getTime() / 1000);
}

/**
 * С какого момента прежние сеансы недействительны: позднее из смены (сброса)
 * пароля и явного завершения сеансов («выйти на других устройствах»,
 * администратор — «завершить сеансы»).
 */
export function sessionCutoff(passwordChangedAt: Date | null, sessionsRevokedAt: Date | null): Date | null {
  if (!passwordChangedAt) return sessionsRevokedAt;
  if (!sessionsRevokedAt) return passwordChangedAt;
  return passwordChangedAt > sessionsRevokedAt ? passwordChangedAt : sessionsRevokedAt;
}
