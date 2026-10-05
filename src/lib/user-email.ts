/**
 * Адрес почты пользователя — он же логин: без пробелов по краям, в нижнем
 * регистре, вида «имя@домен.зона», не длиннее 254 символов.
 */
export function normalizeUserEmail(raw: unknown): { email: string } | { error: string } {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email) return { error: "Укажите email" };
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: `«${email}» не похоже на адрес почты` };
  return { email };
}
