/**
 * Правила для ролей: название без дублей, уникальный код, когда роль можно
 * удалить. Чистые функции — проверяются тестами.
 */

const normalize = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Проблема с названием роли или null. existingNames — названия других ролей. */
export function roleNameProblem(name: string, existingNames: string[]): string | null {
  const clean = name.trim();
  if (!clean) return "Название роли обязательно";
  if (clean.length > 100) return "Название роли — не длиннее 100 символов";
  if (existingNames.some((n) => normalize(n) === normalize(clean))) return `Роль «${clean}» уже есть — выберите другое название`;
  return null;
}

/** Код роли из названия: латиница/кириллица и цифры через «_»; при совпадении — с номером. */
export function uniqueRoleCode(name: string, existingCodes: string[]): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^a-zа-я0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "") || "role";
  const taken = new Set(existingCodes);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

/** Можно ли удалить роль; null — можно. */
export function roleDeleteProblem(role: { isSystem: boolean; userCount: number; routeNames: string[] }): string | null {
  if (role.isSystem) return "Системную роль удалить нельзя — можно изменить её права";
  if (role.userCount > 0) return `Роль назначена пользователям (${role.userCount}) — сначала снимите её с них`;
  if (role.routeNames.length > 0) return `Роль участвует в маршрутах согласования: ${role.routeNames.join(", ")} — сначала уберите её из шагов`;
  return null;
}
