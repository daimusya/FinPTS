/**
 * Адрес внутри приложения (для переходов после действий и ссылок
 * уведомлений): начинается с «/», но не «//» и не «/\» — такие браузер
 * понимает как адрес другого сайта.
 */
export function isInternalPath(path: unknown): path is string {
  return typeof path === "string" && path.startsWith("/") && !/^\/[/\\]/.test(path) && !/[\r\n]/.test(path);
}
