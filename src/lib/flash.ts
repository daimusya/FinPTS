import { cookies } from "next/headers";

/**
 * Одноразовое серверное сообщение между Server Action и следующей
 * загрузкой страницы — httpOnly-куки вместо query-параметра, чтобы
 * чувствительные значения (например, временный пароль) не попадали в URL,
 * логи доступа и заголовок Referer. Значение показывается один раз: страница
 * после показа удаляет куку (компонент FlashConsumed → DELETE /api/flash).
 */
export const FLASH_NAMES = ["tempPassword"] as const;
export type FlashName = (typeof FLASH_NAMES)[number];

export function isFlashName(name: string): name is FlashName {
  return (FLASH_NAMES as readonly string[]).includes(name);
}

export async function setFlash(name: FlashName, value: string): Promise<void> {
  const store = await cookies();
  store.set(`flash_${name}`, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60,
  });
}

/**
 * Читает флеш-значение из Server Component (страницы рендера). Next.js не
 * разрешает удалять cookie во время рендера — его удаляет FlashConsumed сразу
 * после показа; если запрос не дойдёт, кука истечёт через 60 секунд (maxAge).
 */
export async function readFlash(name: FlashName): Promise<string | null> {
  const store = await cookies();
  return store.get(`flash_${name}`)?.value ?? null;
}

export async function clearFlash(name: FlashName): Promise<void> {
  const store = await cookies();
  store.delete(`flash_${name}`);
}
