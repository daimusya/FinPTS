/**
 * Заголовки безопасности для всех ответов (next.config.ts):
 * - страницы нельзя встроить в чужой сайт во фрейм (кликджекинг: невидимая
 *   кнопка «Согласовать» поверх чужой страницы);
 * - браузер не угадывает тип файлов (выгрузки, вложения);
 * - адрес страниц (с id записей и фильтрами) не уходит на другие сайты;
 * - формы отправляются только на этот сайт, плагины и чужой <base> запрещены;
 * - камера, микрофон и геолокация странице не нужны.
 * Строгий запрет встроенных скриптов (script-src) не включён: Next.js
 * встраивает свои скрипты, для этого нужны одноразовые ключи (nonce).
 * HSTS — только в рабочем режиме: в разработке сайт работает по http.
 */
export interface SecurityHeader {
  key: string;
  value: string;
}

export function securityHeaders(production: boolean): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "same-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ];
  if (production) headers.push({ key: "Strict-Transport-Security", value: "max-age=15552000" });
  return headers;
}
