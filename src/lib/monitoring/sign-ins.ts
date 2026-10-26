import { MAX_FAILURES, MAX_IP_FAILURES, lockedMinutesFor } from "@/lib/login-throttle";
import type { CheckResult } from "@/lib/monitoring/checks";

/**
 * Неудачные попытки входа за сутки (таблица login_failures: ключ — почта,
 * «ip:адрес» или «mfa:id пользователя») — для мониторинга. Чистые функции.
 */
export interface SignInFacts {
  /** Неверных паролей за сутки. */
  passwordFailures: number;
  /** Учётные записи (существующие), заблокированные сейчас за подбор пароля. */
  lockedAccounts: string[];
  /** Адресов в интернете, заблокированных сейчас за перебор. */
  lockedAddresses: number;
  /** Неверные коды второго шага по людям: пароль верный, код нет — пароль, вероятно, знает посторонний. */
  codeFailures: Array<{ name: string; count: number }>;
}

/** Сколько неверных кодов второго шага за сутки уже тревожно (одна-две ошибки — опечатки). */
export const CODE_FAILURE_ALERT = 3;

export function summarizeSignIns(
  rows: Array<{ email: string; createdAt: Date }>,
  now: Date,
  people: { byEmail: Map<string, string>; byId: Map<string, string> },
): SignInFacts {
  const groups = new Map<string, Date[]>();
  for (const r of rows) groups.set(r.email, [...(groups.get(r.email) ?? []), r.createdAt]);
  const facts: SignInFacts = { passwordFailures: 0, lockedAccounts: [], lockedAddresses: 0, codeFailures: [] };
  for (const [key, dates] of groups) {
    if (key.startsWith("ip:")) {
      if (lockedMinutesFor(dates, now, MAX_IP_FAILURES) > 0) facts.lockedAddresses++;
    } else if (key.startsWith("mfa:")) {
      const name = people.byId.get(key.slice(4));
      if (name) facts.codeFailures.push({ name, count: dates.length });
    } else {
      facts.passwordFailures += dates.length;
      const name = people.byEmail.get(key);
      if (name && lockedMinutesFor(dates, now, MAX_FAILURES) > 0) facts.lockedAccounts.push(name);
    }
  }
  facts.codeFailures.sort((a, b) => b.count - a.count);
  return facts;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

/**
 * Сбой — кто-то ошибается в коде второго шага при верном пароле (пароль,
 * вероятно, известен постороннему: сменить его); предупреждение — учётная
 * запись или адрес заблокированы за подбор.
 */
export function checkSignIns(facts: SignInFacts): CheckResult {
  const base = { key: "sign_ins", title: "Попытки входа", link: "/admin/users" };
  const suspicious = facts.codeFailures.filter((c) => c.count >= CODE_FAILURE_ALERT);
  if (suspicious.length > 0) {
    return {
      ...base,
      status: "fail",
      message: `Верный пароль, но неверный код второго шага: ${suspicious.map((c) => `${c.name} — ${c.count} ${plural(c.count, "раз", "раза", "раз")}`).join(", ")} за сутки. Пароль, вероятно, знает посторонний — пусть человек сменит его, а при сомнениях завершите его сеансы`,
    };
  }
  const parts: string[] = [];
  if (facts.lockedAccounts.length > 0) parts.push(`заблокирован вход после ${MAX_FAILURES} неверных паролей: ${facts.lockedAccounts.join(", ")}`);
  if (facts.lockedAddresses > 0) {
    parts.push(`${facts.lockedAddresses} ${plural(facts.lockedAddresses, "адрес", "адреса", "адресов")} в интернете заблокированы за перебор паролей`);
  }
  if (parts.length > 0) return { ...base, status: "warn", message: `${parts.join("; ")}. Неверных паролей за сутки: ${facts.passwordFailures}` };
  return {
    ...base,
    status: "ok",
    message: facts.passwordFailures > 0 ? `Неверных паролей за сутки: ${facts.passwordFailures} — без блокировок` : "Неудачных попыток входа за сутки нет",
  };
}
